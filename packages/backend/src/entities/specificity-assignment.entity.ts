import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import type { ModelRoute } from 'manifest-shared';
import { timestampType, timestampDefault } from '../common/utils/postgres-sql';

@Entity('specificity_assignments')
@Index(['agent_id', 'category'], { unique: true })
export class SpecificityAssignment {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  user_id!: string;

  @Column('varchar')
  agent_id!: string;

  @Column('varchar')
  category!: string;

  @Column('boolean', { default: false })
  is_active!: boolean;

  @Column('varchar', { nullable: true })
  override_model!: string | null;

  @Column('varchar', { nullable: true })
  override_provider!: string | null;

  @Column('varchar', { nullable: true })
  override_auth_type!: 'api_key' | 'subscription' | 'local' | null;

  @Column('varchar', { nullable: true })
  auto_assigned_model!: string | null;

  @Column('simple-json', { nullable: true })
  fallback_models!: string[] | null;

  // Dual-write route columns. See TierAssignment for the rollout plan.
  @Column('jsonb', { nullable: true })
  override_route!: ModelRoute | null;

  @Column('jsonb', { nullable: true })
  auto_assigned_route!: ModelRoute | null;

  @Column('jsonb', { nullable: true })
  fallback_routes!: ModelRoute[] | null;

  @Column(timestampType(), { default: timestampDefault() })
  updated_at!: string;
}
