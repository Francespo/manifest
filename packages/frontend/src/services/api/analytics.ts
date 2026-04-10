import { fetchJson } from './core.js';

export function getOverview(range = '24h', agentName?: string) {
  return fetchJson('/overview', { range, ...(agentName ? { agent_name: agentName } : {}) });
}

export function getHealth() {
  return fetchJson('/health');
}

export function getModelPrices() {
  return fetchJson('/model-prices');
}

export interface CallerRow {
  app_name: string | null;
  app_url: string | null;
  sdk: string | null;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  first_seen: string;
  last_seen: string;
}

export interface SdkRow {
  sdk: string | null;
  message_count: number;
  cost_usd: number;
}

export interface CallersData {
  callers: CallerRow[];
  sdks: SdkRow[];
  total_messages: number;
  attributed_messages: number;
}

export function getCallers(range = '24h', agentName?: string): Promise<CallersData> {
  return fetchJson<CallersData>('/callers', {
    range,
    ...(agentName ? { agent_name: agentName } : {}),
  });
}
