import { ScoringReason } from '../../scoring';
import type { AuthType, ModelRoute, SpecificityCategory, TierSlot } from 'manifest-shared';

export type { AuthType } from 'manifest-shared';

export interface ResolveResponse {
  tier: TierSlot;
  model: string | null;
  provider: string | null;
  confidence: number;
  score: number;
  reason: ScoringReason;
  auth_type?: AuthType;
  specificity_category?: SpecificityCategory;
  fallback_models?: string[] | null;
  header_tier_id?: string;
  header_tier_name?: string;
  header_tier_color?: string;
  // Additive route fields. Populated alongside the flat fields above for
  // every successful resolve so external callers can opt in to the
  // unambiguous shape without breaking the existing contract.
  route?: ModelRoute | null;
  fallback_routes?: ModelRoute[] | null;
}
