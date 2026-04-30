import type { ModelRoute, AuthType } from 'manifest-shared';
import { isModelRoute, isModelRouteArray } from 'manifest-shared';
import type { TierAssignment } from '../../entities/tier-assignment.entity';
import type { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import type { HeaderTier } from '../../entities/header-tier.entity';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';

type AnyOverrideRow = Pick<
  TierAssignment | SpecificityAssignment | HeaderTier,
  'override_route' | 'fallback_routes'
>;

type AnyAutoRow = Pick<TierAssignment | SpecificityAssignment, 'auto_assigned_route'>;

export function readOverrideRoute(row: AnyOverrideRow): ModelRoute | null {
  return isModelRoute(row.override_route) ? row.override_route : null;
}

export function readAutoAssignedRoute(row: AnyAutoRow): ModelRoute | null {
  return isModelRoute(row.auto_assigned_route) ? row.auto_assigned_route : null;
}

export function readFallbackRoutes(row: AnyOverrideRow): ModelRoute[] | null {
  return isModelRouteArray(row.fallback_routes) ? row.fallback_routes : null;
}

export function effectiveRoute(row: AnyOverrideRow & AnyAutoRow): ModelRoute | null {
  return readOverrideRoute(row) ?? readAutoAssignedRoute(row);
}

/**
 * Build a ModelRoute from the explicit (provider, authType, model) triple.
 * Returns null when any field is missing.
 */
export function explicitRoute(
  model: string,
  provider: string | undefined,
  authType: AuthType | undefined,
): ModelRoute | null {
  if (!provider || !authType) return null;
  return { provider, authType, model };
}

/**
 * Resolve a model name to a single ModelRoute via the discovered model list.
 * Returns null when the name doesn't match exactly one (provider, authType)
 * pair — ambiguous matches require the caller to pass an explicit route.
 */
export function unambiguousRoute(model: string, available: DiscoveredModel[]): ModelRoute | null {
  const matches = available.filter((m) => m.id === model);
  if (matches.length !== 1) return null;
  const m = matches[0];
  if (!m.authType) return null;
  return { provider: m.provider, authType: m.authType, model: m.id };
}
