import { fetchJson } from './core.js';
import type { ModelQuotaStatusResponse } from 'manifest-shared';

export async function getModelQuotaStatus(): Promise<ModelQuotaStatusResponse> {
  return fetchJson<ModelQuotaStatusResponse>('/model-quotas/status', undefined, { cache: false });
}
