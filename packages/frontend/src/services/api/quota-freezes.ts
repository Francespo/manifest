import { fetchJson, fetchMutate, routingPath } from './core.js';

export type QuotaFreezeReason = 'hour' | 'day' | 'week';

export interface QuotaFreeze {
  provider: string;
  authType: string;
  providerKeyLabel: string | null;
  reason: QuotaFreezeReason;
  message: string;
  exhaustedUntil: number;
  remainingMs: number;
  remainingLabel: string;
}

export function listQuotaFreezes(agentName: string) {
  return fetchJson<{ freezes: QuotaFreeze[] }>(routingPath(agentName, 'quota-freezes'));
}

export function resumeQuotaFreeze(
  agentName: string,
  provider: string,
  authType: string,
  providerKeyLabel?: string,
) {
  return fetchMutate<{ ok: boolean }>(routingPath(agentName, 'quota-freezes/resume'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, authType, providerKeyLabel }),
  });
}
