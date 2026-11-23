import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import type { AuthType, ModelEgress } from 'manifest-shared';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

/**
 * Per-model outbound egress policy for a tenant.
 *
 * The same model can be reached through different provider connections, but
 * the egress decision belongs to the model identity, not to a specific API
 * key: two OpenCode Go keys serving the same model must both use (or skip)
 * the US gateway. `auth_type` stays in the key because OpenCode Go exposes the
 * same provider id under subscription and, in theory, other auth types.
 *
 * A missing row means "auto": the provider/model default applies. The
 * dashboard writes an explicit `direct` row to turn off an auto-US model.
 */
@Entity('model_egress_policies')
@Index(['tenant_id', 'provider', 'auth_type', 'model'], { unique: true })
export class ModelEgressPolicy {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  tenant_id!: string;

  /** Canonical provider id, lowercased at write time. */
  @Column('varchar')
  provider!: string;

  @Column('varchar', { default: 'api_key' })
  auth_type!: AuthType;

  @Column('varchar')
  model!: string;

  @Column('varchar')
  egress!: ModelEgress;

  @Column(timestampType(), { default: timestampDefault() })
  created_at!: string;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}
