import { Injectable } from '@nestjs/common';
import {
  isUsEgressConfigured,
  OPENCODE_GO_HF_TOKEN,
  OPENCODE_GO_PROXY_BASE,
} from './proxy/provider-endpoints';

export interface UsEgressHealth {
  configured: boolean;
  reachable: boolean;
  status: string;
  target: string | null;
  latency_ms: number | null;
}

const HEALTH_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Lightweight health probe for the US gateway. The dashboard uses it to show
 * whether the proxy is awake before a user flips a model to US routing; the
 * result is cached briefly so opening several panels does not wake the Space
 * repeatedly.
 */
@Injectable()
export class UsEgressService {
  private cached: { value: UsEgressHealth; expiresAt: number } | null = null;

  async health(): Promise<UsEgressHealth> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.value;

    let value: UsEgressHealth;
    if (!isUsEgressConfigured()) {
      value = {
        configured: false,
        reachable: false,
        status: 'unconfigured',
        target: null,
        latency_ms: null,
      };
    } else {
      const started = Date.now();
      try {
        const base = OPENCODE_GO_PROXY_BASE.replace(/\/+$/, '');
        const response = await fetch(`${base}/health`, {
          headers: { Authorization: `Bearer ${OPENCODE_GO_HF_TOKEN}` },
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        const body = (await response.json().catch(() => null)) as { target?: unknown } | null;
        value = {
          configured: true,
          reachable: response.ok,
          status: response.ok ? 'ok' : `http_${response.status}`,
          target: typeof body?.target === 'string' ? body.target : null,
          latency_ms: Date.now() - started,
        };
      } catch {
        value = {
          configured: true,
          reachable: false,
          status: 'unreachable',
          target: null,
          latency_ms: Date.now() - started,
        };
      }
    }

    this.cached = { value, expiresAt: now + HEALTH_TTL_MS };
    return value;
  }

  /** Test hook: drop the cached probe result. */
  resetCache(): void {
    this.cached = null;
  }
}
