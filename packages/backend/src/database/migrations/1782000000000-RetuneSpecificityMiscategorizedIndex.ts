import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces IDX_agent_messages_miscategorized with one keyed by agent_id first.
 * SpecificityPenaltyService runs on every resolve when specificity is active
 * and filters by agent_id (no tenant_id), so a leading tenant_id column made
 * the previous partial index unhelpful.
 *
 * Runs outside a transaction so CREATE INDEX CONCURRENTLY can be used to avoid
 * blocking writes on agent_messages during boot-time migration.
 */
export class RetuneSpecificityMiscategorizedIndex1782000000000 implements MigrationInterface {
  name = 'RetuneSpecificityMiscategorizedIndex1782000000000';
  // Required to permit CONCURRENTLY — TypeORM otherwise wraps each migration in
  // a transaction, and CREATE INDEX CONCURRENTLY is rejected inside one.
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_agent_messages_miscategorized"`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_agent_messages_miscategorized" ON "agent_messages" ("agent_id", "specificity_category") WHERE "specificity_miscategorized" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_agent_messages_miscategorized"`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_agent_messages_miscategorized" ON "agent_messages" ("tenant_id", "agent_id", "specificity_category") WHERE "specificity_miscategorized" = true`,
    );
  }
}
