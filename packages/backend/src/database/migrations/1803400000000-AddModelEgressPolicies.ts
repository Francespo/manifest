import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-model US egress policies.
 *
 * OpenCode Go/Zen gate some models by caller region (Crouton Alpha today).
 * Until now the proxy hardcoded a model-name check, so enabling a new
 * region-gated model required a deploy. This table lets the dashboard toggle
 * the US gateway per (tenant, provider, auth_type, model). A missing row means
 * "auto": the provider/model default applies, which keeps existing behaviour
 * without a backfill.
 */
export class AddModelEgressPolicies1803400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET lock_timeout = '5s'`);
    try {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "model_egress_policies" (
          "id" varchar PRIMARY KEY,
          "tenant_id" varchar NOT NULL,
          "provider" varchar NOT NULL,
          "auth_type" varchar NOT NULL DEFAULT 'api_key',
          "model" varchar NOT NULL,
          "egress" varchar NOT NULL,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_model_egress_policies_route"
        ON "model_egress_policies" ("tenant_id", "provider", "auth_type", "model")
      `);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "idx_model_egress_policies_tenant"
        ON "model_egress_policies" ("tenant_id")
      `);
    } finally {
      await queryRunner.query(`RESET lock_timeout`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "model_egress_policies"`);
  }
}
