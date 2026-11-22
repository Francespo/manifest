/**
 * Where Manifest sends an upstream provider request.
 *
 * `direct` reaches the provider from Manifest's own egress. `us` sends the
 * request through the configured US gateway, which is required by providers
 * that gate access by caller region. The policy is stored per
 * (tenant, provider, auth type, model) so a single model can opt in without
 * moving every other model of that provider.
 */
export type ModelEgress = 'direct' | 'us';

/**
 * The value the dashboard writes. `auto` removes the explicit policy and lets
 * the provider/model default apply.
 */
export type ModelEgressSetting = ModelEgress | 'auto';

export const MODEL_EGRESS_VALUES: readonly ModelEgress[] = ['direct', 'us'];
export const MODEL_EGRESS_SETTINGS: readonly ModelEgressSetting[] = ['auto', 'direct', 'us'];
