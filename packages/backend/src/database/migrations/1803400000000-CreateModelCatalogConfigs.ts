import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant-wide configuration for the scoped `/v1/catalog/<variant>/models`
 * catalogs. One row per tenant, both lists default to empty so a fresh install
 * publishes only synthetic models on the scoped endpoints until the dashboard
 * curates a pool or picks custom providers. The default `/v1/models` response
 * is not affected by this table.
 */
export class CreateModelCatalogConfigs1803400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "model_catalog_configs" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "pool_model_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "custom_provider_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_model_catalog_configs_tenant"
      ON "model_catalog_configs" ("tenant_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "model_catalog_configs"`);
  }
}
