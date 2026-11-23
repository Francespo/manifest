import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

/**
 * Tenant-wide selection behind the scoped `/v1/catalog/*` model lists.
 *
 * One row per tenant. Unset columns mean the corresponding scoped catalog has
 * no curated entries yet (only synthetic models are published there), which is
 * safe: the default `/v1/models` catalog is untouched by this table.
 */
@Entity('model_catalog_configs')
@Index(['tenant_id'], { unique: true })
export class ModelCatalogConfigEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  /** Public `/v1/models` ids curated into the manual pool. */
  @Column('jsonb')
  pool_model_ids!: string[];

  /** Internal ids of the custom providers whose whole catalog is published. */
  @Column('jsonb')
  custom_provider_ids!: string[];

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}
