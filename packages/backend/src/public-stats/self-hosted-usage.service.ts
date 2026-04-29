import { Injectable, Logger } from '@nestjs/common';
import { isSelfHosted } from '../common/utils/detect-self-hosted';

export const DEFAULT_AGGREGATE_ENDPOINT = 'https://telemetry.manifest.build/v1/aggregate/usage';

const CACHE_TTL_MS = 60_000;
const FAILURE_CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 2_000;

export interface SelfHostedUsageConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
}

export interface SelfHostedAggregate {
  messages_total: number;
}

/**
 * Cloud-side fetcher for the fleet-wide self-hosted message count exposed by
 * peacock at `GET /v1/aggregate/usage`. The result is added to the cloud
 * count surfaced by `/api/v1/public/usage` so the marketing site can show
 * total usage across both deployments.
 *
 * Authenticates with peacock via `X-Aggregate-Key`, matched against
 * `PEACOCK_AGGREGATE_KEY` on the peacock side. The shared secret is what
 * keeps the aggregate endpoint off the public internet.
 *
 * Disabled outside Manifest Cloud production:
 *   - When `TELEMETRY_AGGREGATE_KEY` is unset (no shared secret to send) —
 *     the request would be rejected anyway, and we'd rather not generate
 *     log noise on every cache miss.
 *   - Self-hosted instances (per `isSelfHosted()`) skip the fetch entirely —
 *     they'd be querying a number that includes their own contribution and
 *     the public-stats endpoint isn't on for them anyway.
 *   - Non-production envs skip too, mirroring `TelemetryService`'s gate.
 *
 * Never throws. On timeout, non-2xx, network error, or malformed payload it
 * returns null and the public endpoint falls back to the cloud-only count.
 */
@Injectable()
export class SelfHostedUsageService {
  private readonly logger = new Logger(SelfHostedUsageService.name);
  private readonly config: SelfHostedUsageConfig = buildSelfHostedUsageConfig();

  private cached: SelfHostedAggregate | null = null;
  private cachedAt = 0;
  private cachedFailure = false;
  private inflight: Promise<SelfHostedAggregate | null> | null = null;

  async fetchAggregate(): Promise<SelfHostedAggregate | null> {
    if (!this.config.enabled) return null;
    if (this.cachedAt > 0) {
      const ttl = this.cachedFailure ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS;
      if (Date.now() - this.cachedAt < ttl) return this.cached;
    }
    if (!this.inflight) {
      this.inflight = this.compute().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async compute(): Promise<SelfHostedAggregate | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(this.config.endpoint, {
        signal: ac.signal,
        headers: { 'x-aggregate-key': this.config.apiKey },
      });
      if (!res.ok) {
        this.logger.warn(`Aggregate endpoint returned ${res.status}`);
        return this.cacheFailure();
      }
      const json = (await res.json()) as Record<string, unknown>;
      const raw = json['messages_total'];
      if (typeof raw !== 'number' && typeof raw !== 'string') {
        this.logger.warn(`Aggregate endpoint returned invalid messages_total: ${String(raw)}`);
        return this.cacheFailure();
      }
      if (typeof raw === 'string' && raw.trim().length === 0) {
        this.logger.warn('Aggregate endpoint returned empty messages_total');
        return this.cacheFailure();
      }
      const messages_total = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(messages_total) || messages_total < 0) {
        this.logger.warn(`Aggregate endpoint returned invalid messages_total: ${String(raw)}`);
        return this.cacheFailure();
      }
      const result: SelfHostedAggregate = { messages_total };
      this.cached = result;
      this.cachedFailure = false;
      this.cachedAt = Date.now();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Aggregate fetch failed: ${msg}`);
      return this.cacheFailure();
    } finally {
      clearTimeout(timer);
    }
  }

  private cacheFailure(): null {
    this.cached = null;
    this.cachedFailure = true;
    this.cachedAt = Date.now();
    return null;
  }
}

export function buildSelfHostedUsageConfig(
  env: NodeJS.ProcessEnv = process.env,
): SelfHostedUsageConfig {
  const endpoint = env['TELEMETRY_AGGREGATE_ENDPOINT'] ?? DEFAULT_AGGREGATE_ENDPOINT;
  const apiKey = env['TELEMETRY_AGGREGATE_KEY'] ?? '';
  const isProd = (env['NODE_ENV'] ?? 'development') === 'production';
  return {
    enabled: isProd && !isSelfHosted() && apiKey.length > 0,
    endpoint,
    apiKey,
  };
}
