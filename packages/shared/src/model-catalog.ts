/**
 * Scoped `/v1/models` catalogs.
 *
 * A client only swaps its base URL to pick a catalog: every proxy route is
 * served under `/catalog/<variant>/v1/…`, so the sdk keeps appending `/models`,
 * `/chat/completions`, … to a valid base URL. Only the model list changes; the
 * proxy behaviour behind the other routes is identical to `/v1/…`.
 *
 * The unprefixed `/v1/models` remains the full catalog ("tutto come adesso").
 */
export const MODEL_CATALOG_VARIANTS = [
  'synthetic',
  'synthetic-pool',
  'synthetic-providers',
] as const;

export type ModelCatalogVariant = (typeof MODEL_CATALOG_VARIANTS)[number];

export function isModelCatalogVariant(value: string): value is ModelCatalogVariant {
  return (MODEL_CATALOG_VARIANTS as readonly string[]).includes(value);
}

/**
 * Base URL suffix a client configures to select one scoped catalog.
 *
 * The variant goes BEFORE `/v1` on purpose: the URL still ends in `/v1`, so
 * every sdk keeps its existing convention (OpenAI appends `/models`,
 * Anthropic strips the trailing `/v1` and appends `/v1/messages`). Swapping
 * this one string is the only client-side change.
 */
export function modelCatalogPath(variant: ModelCatalogVariant): string {
  return `/catalog/${variant}/v1`;
}

/** Tenant-wide selection that backs the `synthetic-pool` and `synthetic-providers` catalogs. */
export interface ModelCatalogConfig {
  /** Public `/v1/models` ids curated into the manual pool. */
  pool_model_ids: string[];
  /** Internal ids of the custom providers whose whole model list is published. */
  custom_provider_ids: string[];
}

export interface ModelCatalogOption {
  id: string;
  label: string;
}

/** Choices offered by the dashboard editor for a tenant's catalog config. */
export interface ModelCatalogOptions {
  pool_models: ModelCatalogOption[];
  custom_providers: ModelCatalogOption[];
}

export interface ModelCatalogResponse extends ModelCatalogConfig {
  options: ModelCatalogOptions;
}
