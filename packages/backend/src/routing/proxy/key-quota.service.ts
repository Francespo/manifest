import { Injectable, Logger } from '@nestjs/common';

export interface KeyQuotaInfo {
  exhaustedUntil: number; // timestamp in ms
  reason: 'day' | 'week' | 'hour';
  message: string;
}

/** Structured view of an active freeze, for the dashboard API. */
export interface QuotaFreezeView {
  provider: string;
  authType: string;
  providerKeyLabel: string | null;
  reason: 'hour' | 'day' | 'week';
  message: string;
  exhaustedUntil: number;
  remainingMs: number;
  remainingLabel: string;
}

export interface QuotaFailureRecord {
  timestamp: number;
}

/**
 * Freeze tiers, shortest to longest:
 *
 *  - `hour`  — error body says the limit is per-hour → frozen until the end
 *              of the current UTC hour (the limit resets on the hour).
 *  - `day`   — daily / general quota exhaustion → frozen until the end of the
 *              current UTC day.
 *  - `week`  — weekly quota exhaustion or a >24h Retry-After → frozen 7 days.
 *
 * Per-minute / per-second limits and short Retry-After values are treated as
 * transient (RPM bursts) and NEVER freeze — they recover in seconds.
 *
 * The sliding window (QUOTA_FAIL_WINDOW_MIN_FAILURES within
 * QUOTA_FAIL_WINDOW_MS) only counts 429s whose language signals a LONG reset
 * (quota/exhausted/insufficient/daily/weekly/free — but NOT per-minute or
 * per-hour), so a bursty RPM limit can never accumulate toward a day-long
 * freeze.
 */
const QUOTA_FAIL_WINDOW_MIN_FAILURES = 3;
const QUOTA_FAIL_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class KeyQuotaService {
  private readonly logger = new Logger(KeyQuotaService.name);
  private readonly exhaustedKeys = new Map<string, KeyQuotaInfo>();
  private readonly keyFailures = new Map<string, QuotaFailureRecord[]>();
  private recordCounter = 0;

  /**
   * Build a unique cache key for a specific agent key credential.
   */
  buildKey(agentId: string, provider: string, authType: string, providerKeyLabel?: string): string {
    const label =
      !providerKeyLabel || providerKeyLabel.toLowerCase() === 'default' ? '' : providerKeyLabel;
    return [agentId || '', provider.toLowerCase(), authType || '', label].join('\u0000');
  }

  /**
   * Check if a key's free quota is currently exhausted.
   * Returns KeyQuotaInfo if exhausted, or null if active / expired.
   */
  isKeyQuotaExhausted(
    agentId: string,
    provider: string,
    authType: string,
    providerKeyLabel?: string,
  ): KeyQuotaInfo | null {
    const key = this.buildKey(agentId, provider, authType, providerKeyLabel);
    const info = this.exhaustedKeys.get(key);
    if (!info) return null;
    if (info.exhaustedUntil <= Date.now()) {
      this.exhaustedKeys.delete(key);
      return null;
    }
    return info;
  }

  /**
   * Human-readable time left on a freeze, e.g. "6h 23m". All freeze log lines
   * render through this so "how long will it last" is one consistent string.
   */
  remainingLabel(until: number, now = Date.now()): string {
    const ms = Math.max(0, until - now);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${Math.max(1, Math.ceil(ms / 1000))}s`;
  }

  /** Structured view of an active freeze, for the dashboard API. */
  listFreezes(agentId: string): QuotaFreezeView[] {
    const now = Date.now();
    const out: QuotaFreezeView[] = [];
    for (const [key, info] of this.exhaustedKeys) {
      if (info.exhaustedUntil <= now) continue;
      const [agent, provider, authType, providerKeyLabel] = key.split('\u0000');
      if (agent !== agentId) continue;
      out.push({
        provider,
        authType,
        providerKeyLabel: providerKeyLabel || null,
        reason: info.reason,
        message: info.message,
        exhaustedUntil: info.exhaustedUntil,
        remainingMs: info.exhaustedUntil - now,
        remainingLabel: this.remainingLabel(info.exhaustedUntil, now),
      });
    }
    return out.sort((a, b) => a.exhaustedUntil - b.exhaustedUntil);
  }

  /** Clear a freeze (and its sliding-window counters) so the key is retried immediately. */
  resume(agentId: string, provider: string, authType: string, providerKeyLabel?: string): void {
    const key = this.buildKey(agentId, provider, authType, providerKeyLabel);
    this.exhaustedKeys.delete(key);
    this.keyFailures.delete(key);
  }

  /**
   * Record a response from an API attempt. If it indicates quota exhaustion for the day/week,
   * mark the key as exhausted and return the KeyQuotaInfo.
   */
  recordAttemptResult(opts: {
    agentId?: string;
    provider: string;
    authType?: string;
    providerKeyLabel?: string;
    status: number;
    headers?: Headers | Record<string, string | string[] | undefined>;
    errorBody?: string;
  }): KeyQuotaInfo | null {
    if (!opts.agentId || !opts.authType) return null;
    const { status, errorBody, headers } = opts;

    // Quota exhaustion only triggers on rate-limit / payment / quota error codes (429, 402, 403).
    if (status !== 429 && status !== 402 && status !== 403) return null;

    const lowerBody = (errorBody || '').toLowerCase();
    const retryAfter = this.getHeader(headers, 'retry-after');

    const duration = this.detectQuotaExhaustionDuration(
      status,
      retryAfter,
      lowerBody,
      opts.agentId,
      opts.provider,
      opts.authType,
      opts.providerKeyLabel,
    );
    if (!duration) return null;

    const key = this.buildKey(opts.agentId, opts.provider, opts.authType, opts.providerKeyLabel);
    const now = Date.now();
    let exhaustedUntil: number;

    if (duration.untilMs !== undefined) {
      // The provider stated an exact reset instant (e.g. OpenCode Zen's
      // "[retrying in 10h 37m]") — trust it directly.
      exhaustedUntil = now + duration.untilMs;
    } else if (duration.type === 'week') {
      exhaustedUntil = now + 7 * 24 * 60 * 60 * 1000;
    } else if (duration.type === 'hour') {
      // 'hour': until the end of the current UTC hour (the limit resets on
      // the hour), floored at 10 minutes so a freeze always buys real time.
      const nextUtcHour = new Date();
      nextUtcHour.setUTCMinutes(0, 0, 0);
      nextUtcHour.setUTCHours(nextUtcHour.getUTCHours() + 1);
      exhaustedUntil = Math.max(now + 10 * 60 * 1000, nextUtcHour.getTime());
    } else {
      // 'day': calculate end of current UTC day (23:59:59.999 UTC), min 1 hour from now
      const nextUtcDay = new Date();
      nextUtcDay.setUTCHours(23, 59, 59, 999);
      exhaustedUntil = Math.max(now + 60 * 60 * 1000, nextUtcDay.getTime());
    }

    const info: KeyQuotaInfo = {
      exhaustedUntil,
      reason: duration.type,
      message: duration.reason,
    };

    this.exhaustedKeys.set(key, info);
    const remaining = this.remainingLabel(exhaustedUntil);
    this.logger.warn(
      `[quota-freeze] APPLIED: provider=${opts.provider} label=${opts.providerKeyLabel || 'default'} ` +
        `auth=${opts.authType} agent=${opts.agentId} reason="${duration.reason}" ` +
        `freeze=${duration.type} remaining=${remaining} until=${new Date(exhaustedUntil).toISOString()} ` +
        `(no retry of this key before then)`,
    );

    // Bounded memory: sweep expired entries periodically so the maps never
    // grow without limit across the process lifetime.
    if (++this.recordCounter % 100 === 0) this.pruneExpired();

    return info;
  }

  private pruneExpired(now = Date.now()): void {
    for (const [key, info] of this.exhaustedKeys) {
      if (info.exhaustedUntil <= now) this.exhaustedKeys.delete(key);
    }
    for (const [key, fails] of this.keyFailures) {
      const live = fails.filter((f) => now - f.timestamp < QUOTA_FAIL_WINDOW_MS);
      if (live.length === 0) this.keyFailures.delete(key);
      else this.keyFailures.set(key, live);
    }
  }

  private detectQuotaExhaustionDuration(
    status: number,
    retryAfterHeader: string | null,
    lowerBody: string,
    agentId: string,
    provider: string,
    authType: string,
    providerKeyLabel?: string,
  ): { type: 'day' | 'week' | 'hour'; reason: string; untilMs?: number } | null {
    // 1. Retry-After header — the provider's own word. >24h means the limit
    //    resets in days (week freeze); >1h is a long block (day freeze). A
    //    short retry-after (<= 1h) is an RPM/hour burst: it must never feed
    //    the sliding window either.
    let hasShortRetryAfter = false;
    if (retryAfterHeader) {
      const retryAfterSec = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
        if (retryAfterSec > 86400) {
          return { type: 'week', reason: `Upstream retry-after header (${retryAfterSec}s > 24h)` };
        }
        if (retryAfterSec > 3600) {
          return { type: 'day', reason: `Upstream retry-after header (${retryAfterSec}s > 1h)` };
        }
        hasShortRetryAfter = true;
      }
    }

    // 2. Check explicit weekly quota keywords (either word order)
    const isWeekly =
      /\b(weekly|7-day|7\s*days?)\b.*\b(quota|limit|exceeded|exhausted|free)\b/i.test(lowerBody) ||
      /\b(quota|limit|free)\b.*\b(weekly|per\s*week|for\s*7\s*days?)\b/i.test(lowerBody);
    if (isWeekly) {
      return { type: 'week', reason: 'Error body indicates weekly quota limit reached' };
    }

    // 3. Check explicit daily quota keywords (either word order)
    const isDaily =
      /\b(daily|24-hour|24\s*hours?|per-day|per\s+day|today)\b.*\b(quota|limit|exceeded|exhausted|free)\b/i.test(
        lowerBody,
      ) ||
      /\b(quota|limit|free)\b.*\b(daily|per\s+day|for\s+today|today)\b/i.test(lowerBody) ||
      /free\s*tier\s*(daily|limit)/i.test(lowerBody) ||
      /limit\s*reached\s*for\s*today/i.test(lowerBody);
    if (isDaily) {
      return { type: 'day', reason: 'Error body indicates daily quota limit reached' };
    }

    // 4. Explicit hourly quota keywords — resets within the hour, so the
    //    freeze is short (end of the current UTC hour), never the whole day.
    const isHourly =
      /\b(hourly|per\s*hour|per-hour)\b.*\b(quota|limit|exceeded|exhausted)\b/i.test(lowerBody) ||
      /\b(quota|limit)\b.*\b(hourly|per\s*hour|per-hour)\b/i.test(lowerBody);
    if (isHourly) {
      return { type: 'hour', reason: 'Error body indicates hourly quota limit reached' };
    }

    // 5. Per-minute / per-second limits are transient by definition — they
    //    reset in seconds-to-a-minute. Never freeze on them; the existing
    //    short rate-limit cooldown already handles the burst.
    if (/\bper\s*(minute|second)\b|\bper-(minute|second)\b|\brpm\b/i.test(lowerBody)) {
      return null;
    }

    // 6. OpenCode Zen free-tier limit — the canonical daily free-exhaustion
    //    signal is a JSON error with type "FreeUsageLimitError" and an
    //    embedded reset timer in the message: "Free usage exceeded, add
    //    credits https://opencode.ai/zen [retrying in 10h 37m attempt #1]".
    //    Freeze for exactly the provider-stated duration (capped at 7 days).
    if (
      lowerBody.includes('freeusagelimiterror') ||
      lowerBody.includes('free usage exceeded') ||
      lowerBody.includes('free usage limit')
    ) {
      const retryMs = this.parseEmbeddedRetry(lowerBody);
      const type =
        retryMs === undefined
          ? 'day'
          : retryMs > 24 * 3600 * 1000
            ? 'week'
            : retryMs > 3600 * 1000
              ? 'day'
              : 'hour';
      return {
        type,
        reason: 'OpenCode Zen free usage limit reached',
        ...(retryMs !== undefined ? { untilMs: retryMs } : {}),
      };
    }

    // 7. Check general quota exhaustion patterns (RESOURCE_EXHAUSTED, insufficient_quota, etc.)
    const isGeneralQuota =
      lowerBody.includes('insufficient_quota') ||
      lowerBody.includes('quota_exceeded') ||
      lowerBody.includes('exceeded your current quota') ||
      lowerBody.includes('resource_exhausted') ||
      /resource\s*has\s*been\s*exhausted/.test(lowerBody) ||
      (lowerBody.includes('free tier') && lowerBody.includes('quota'));

    if (isGeneralQuota) {
      return { type: 'day', reason: 'Error body indicates quota exhausted' };
    }

    // 7. Sliding window: only quota language that signals a LONG reset
    //    (daily/weekly/general) accumulates — per-minute/hourly words never
    //    count, and a short Retry-After means the provider itself called it
    //    transient. Bare "rate limit" bursts never escalate either.
    if (status === 429 && !hasShortRetryAfter && this.looksLongResetQuota(lowerBody)) {
      const key = this.buildKey(agentId, provider, authType, providerKeyLabel);
      const now = Date.now();
      let fails = this.keyFailures.get(key) || [];
      fails = fails.filter((f) => now - f.timestamp < QUOTA_FAIL_WINDOW_MS);
      fails.push({ timestamp: now });
      this.keyFailures.set(key, fails);

      if (fails.length >= QUOTA_FAIL_WINDOW_MIN_FAILURES) {
        return {
          type: 'day',
          reason: `Repeated quota failures (${fails.length} in 5m)`,
        };
      }
    }

    return null;
  }

  /**
   * Parse a provider-stated reset duration from the error body, e.g.
   * "[retrying in 10h 37m attempt #1]" or "Please retry in 11.7s", into
   * milliseconds (capped at 7 days). Returns undefined when absent.
   */
  private parseEmbeddedRetry(lowerBody: string): number | undefined {
    const m = lowerBody.match(/(?:retrying|retry)\s+in\s+([^\].\n]+?)(?:\s+attempt|\]|\.|$)/i);
    if (!m) return undefined;
    const tokens = m[1]!.match(/(\d+(?:\.\d+)?)\s*([dhms])/g);
    if (!tokens) return undefined;
    let totalMs = 0;
    for (const token of tokens) {
      const t = token.match(/(\d+(?:\.\d+)?)\s*([dhms])/);
      if (!t) continue;
      const value = Number(t[1]);
      const unit = t[2]!;
      if (unit === 'd') totalMs += value * 86_400_000;
      else if (unit === 'h') totalMs += value * 3_600_000;
      else if (unit === 'm') totalMs += value * 60_000;
      else if (unit === 's') totalMs += value * 1000;
    }
    if (totalMs <= 0) return undefined;
    return Math.min(totalMs, 7 * 86_400_000);
  }

  /**
   * Quota-exhaustion language that signals a long reset (day/week), as
   * opposed to transient per-minute/per-hour bursts or bare "rate limit".
   * Per-minute/hourly words are explicitly excluded so a bursty RPM limit
   * can never accumulate toward a day-long freeze.
   */
  private looksLongResetQuota(lowerBody: string): boolean {
    if (/\bper\s*(minute|second)\b|\bper-(minute|second)\b|\brpm\b/i.test(lowerBody)) {
      return false;
    }
    if (/\b(hourly|per\s*hour|per-hour)\b/i.test(lowerBody)) {
      return false;
    }
    return (
      lowerBody.includes('quota') ||
      lowerBody.includes('exhausted') ||
      lowerBody.includes('insufficient') ||
      lowerBody.includes('daily') ||
      lowerBody.includes('weekly') ||
      lowerBody.includes('free tier') ||
      lowerBody.includes('free limit')
    );
  }

  private getHeader(
    headers: Headers | Record<string, string | string[] | undefined> | undefined,
    name: string,
  ): string | null {
    if (!headers) return null;
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name);
    }
    const record = headers as Record<string, string | string[] | undefined>;
    const val = record[name] ?? record[name.toLowerCase()];
    if (Array.isArray(val)) return val[0] ?? null;
    return val ?? null;
  }

  /** Clear stored state (useful for tests). */
  clear(): void {
    this.exhaustedKeys.clear();
    this.keyFailures.clear();
  }
}
