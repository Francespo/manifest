import type { ModelCatalogConfig, ModelCatalogResponse } from 'manifest-shared';
import { fetchJson, fetchMutate } from './core.js';

/** Tenant-level scoped `/v1/models` catalog selection. */
export function getModelCatalog(): Promise<ModelCatalogResponse> {
  return fetchJson<ModelCatalogResponse>('/model-catalog');
}

/** Update the manual model pool and/or the published custom providers. */
export function updateModelCatalog(
  input: Partial<ModelCatalogConfig>,
): Promise<ModelCatalogResponse> {
  return fetchMutate<ModelCatalogResponse>('/model-catalog', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
