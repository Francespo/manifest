import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces IDX_agent_messages_miscategorized with one keyed by agent_id first.
 * SpecificityPenaltyService runs on every resolve when specificity is active
 * and filters by agent_id (no tenant_id), so a leading tenant_id column made
 * the previous partial index unhelpful.
 */
export class RetuneSpecificityMiscategorizedIndex1782000000000 implements MigrationInterface {
  name = 'RetuneSpecificityMiscategorizedIndex1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_messages_miscategorized"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_messages_miscategorized" ON "agent_messages" ("agent_id", "specificity_category") WHERE "specificity_miscategorized" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_messages_miscategorized"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_messages_miscategorized" ON "agent_messages" ("tenant_id", "agent_id", "specificity_category") WHERE "specificity_miscategorized" = true`,
    );
  }
}
