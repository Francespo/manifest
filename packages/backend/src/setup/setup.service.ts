import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateAdminDto } from './dto/create-admin.dto';

/**
 * Postgres advisory lock key reserved for the first-run setup wizard.
 * A random-ish constant — collisions only matter if another call site
 * uses the same key, which we control.
 */
const SETUP_ADVISORY_LOCK_KEY = 9001;

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns true when no Better Auth user exists yet. The login flow uses
   * this to redirect visitors to the setup wizard instead of showing the
   * login form on a fresh install.
   */
  async needsSetup(): Promise<boolean> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM "user"`,
    );
    const count = Number(rows[0]?.count ?? 0);
    return count === 0;
  }

  /**
   * Creates the first admin user via Better Auth, wrapped in a Postgres
   * transaction with an advisory lock so concurrent POSTs can't both
   * succeed. The created user is marked `emailVerified = true` so they
   * can log in immediately without configuring an email provider.
   */
  async createFirstAdmin(dto: CreateAdminDto): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Serialize concurrent setup attempts. The lock is released when
      // the transaction ends (commit or rollback).
      await manager.query(`SELECT pg_advisory_xact_lock($1)`, [SETUP_ADVISORY_LOCK_KEY]);

      const rows = await manager.query<{ count: string }[]>(`SELECT COUNT(*) AS count FROM "user"`);
      const count = Number(rows[0]?.count ?? 0);
      if (count > 0) {
        throw new ConflictException('Setup already completed — an admin user exists');
      }

      // Lazy-require so jest unit and e2e tests that don't exercise this
      // path don't have to load Better Auth's ESM bundle.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { auth } = require('../auth/auth.instance');
      await auth.api.signUpEmail({
        body: {
          email: dto.email,
          password: dto.password,
          name: dto.name,
        },
      });

      await manager.query(`UPDATE "user" SET "emailVerified" = true WHERE email = $1`, [dto.email]);

      this.logger.log(`First-run setup complete — admin user created: ${dto.email}`);
    });
  }
}
