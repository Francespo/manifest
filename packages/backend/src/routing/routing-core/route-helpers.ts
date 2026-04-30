import type { ModelRoute, AuthType } from 'manifest-shared';
import { legacyToRoute, isModelRoute, isModelRouteArray } from 'manifest-shared';
import type { TierAssignment } from '../../entities/tier-assignment.entity';
import type { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import type { HeaderTier } from '../../entities/header-tier.entity';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';

type AnyOverrideRow = Pick<
  TierAssignment | SpecificityAssignment | HeaderTier,
  | 'override_model'
  | 'override_provider'
  | 'override_auth_type'
  | 'override_route'
  | 'fallback_models'
  | 'fallback_routes'
>;

type AnyAutoRow = Pick<
  TierAssignment | SpecificityAssignment,
  'auto_assigned_model' | 'auto_assigned_route'
>;

/**
 * Read-side: prefer the new shape when present, fall back to legacy.
 * Never crashes — both reads are guarded against missing/partial data.
 */
export function readOverrideRoute(row: AnyOverrideRow): ModelRoute | null {
  if (isModelRoute(row.override_route)) return row.override_route;
  return legacyToRoute({
    model: row.override_model,
    provider: row.override_provider,
    authType: row.override_auth_type,
  });
}

export function readAutoAssignedRoute(
  row: AnyAutoRow & Partial<AnyOverrideRow>,
): ModelRoute | null {
  if (isModelRoute(row.auto_assigned_route)) return row.auto_assigned_route;
  // Legacy auto_assigned_model has no provider/auth — caller falls back to
  // existing inference path. Return null so the read-prefers-new contract
  // stays explicit: missing route means "ask the legacy resolver."
  return null;
}

export function readFallbackRoutes(row: AnyOverrideRow): ModelRoute[] | null {
  if (isModelRouteArray(row.fallback_routes)) return row.fallback_routes;
  // Legacy fallback_models is a string[] without provider/auth. Return null
  // here so the proxy falls back to its inference path; the legacy column
  // remains the source of truth for those rows.
  return null;
}

export function effectiveRoute(row: AnyOverrideRow & AnyAutoRow): ModelRoute | null {
  return readOverrideRoute(row) ?? readAutoAssignedRoute(row);
}

/**
 * Build a ModelRoute from the explicit (model, provider, authType) triple
 * passed by an API caller. Returns null when any field is missing — the
 * legacy column path stays authoritative for those rows.
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
 * pair — ambiguous matches stay legacy-only on disk so the proxy's existing
 * inference path handles them.
 */
export function unambiguousRoute(model: string, available: DiscoveredModel[]): ModelRoute | null {
  const matches = available.filter((m) => m.id === model);
  if (matches.length !== 1) return null;
  const m = matches[0];
  if (!m.authType) return null;
  return { provider: m.provider, authType: m.authType, model: m.id };
}
