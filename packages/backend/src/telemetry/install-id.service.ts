import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { InstallMetadata } from '../entities/install-metadata.entity';

export const SINGLETON_ID = 'singleton';

/**
 * Owns the single row in `install_metadata`. Callers must never construct a
 * second row — `getOrCreate()` is idempotent across parallel boots by relying
 * on Postgres `ON CONFLICT DO NOTHING` on the primary key.
 */
@Injectable()
export class InstallIdService {
  constructor(
    @InjectRepository(InstallMetadata)
    private readonly repo: Repository<InstallMetadata>,
  ) {}

  async getOrCreate(): Promise<InstallMetadata> {
    const existing = await this.repo.findOne({ where: { id: SINGLETON_ID } });
    if (existing) return existing;

    const installId = randomUUID();
    const firstSendAt = this.computeFirstSendAt();
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(InstallMetadata)
      .values({
        id: SINGLETON_ID,
        install_id: installId,
        first_send_at: firstSendAt,
        last_sent_at: null,
      })
      .orIgnore()
      .execute();

    const row = await this.repo.findOne({ where: { id: SINGLETON_ID } });
    // Cannot happen: either our INSERT succeeded or a concurrent boot's did;
    // the row must exist. Narrow the type anyway.
    if (!row) throw new Error('install_metadata row missing after upsert');
    return row;
  }

  async markSent(now: Date): Promise<void> {
    await this.repo.update(SINGLETON_ID, { last_sent_at: now.toISOString() });
  }

  /**
   * Picks a random moment in the next 24h as the first legal send time.
   * Jitter prevents a fleet of installs booted via a rolling upgrade from
   * all hitting the ingest endpoint at the same minute.
   */
  private computeFirstSendAt(): string {
    const jitterMs = Math.floor(Math.random() * 24 * 60 * 60 * 1000);
    return new Date(Date.now() + jitterMs).toISOString();
  }
}
