import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import type { KeyQuotaBucketStatus } from 'manifest-shared';
import type { KeyQuotaBucket, QuotaCheckResult, QuotaUsageWindowEntry } from './model-quota.types';
import { findQuotaRule } from './default-model-quotas';

const MINUTE_WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 30_000;

function getUtcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getMsUntilMidnightUtc(now = Date.now()): number {
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  return Math.max(1000, nextMidnight.getTime() - now);
}

function computeKeyIdentity(
  rawKey?: string,
  tenantProviderId?: string | null,
  label?: string,
): string {
  if (rawKey && rawKey.length > 0) {
    return createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
  }
  if (tenantProviderId && tenantProviderId.length > 0) {
    return `tp_${tenantProviderId.slice(0, 16)}`;
  }
  return label && label.length > 0 ? `lbl_${label}` : 'default';
}

@Injectable()
export class ModelQuotaLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(ModelQuotaLimiterService.name);
  private readonly buckets = new Map<string, KeyQuotaBucket>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.evictExpiredBuckets(), CLEANUP_INTERVAL_MS);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /**
   * Check if a request to (provider, model, key) is allowed under predefined quota rules
   * and live sliding-window usage counters. Runs in <0.01ms in-memory.
   */
  checkQuota(opts: {
    provider: string;
    model: string;
    key?: string;
    tenantProviderId?: string | null;
    keyLabel?: string;
    estimatedTokens?: number;
  }): QuotaCheckResult {
    const now = Date.now();
    const rule = findQuotaRule(opts.provider, opts.model);
    const modelFamily = rule?.modelFamily ?? this.inferModelFamily(opts.model);
    const keyIdentity = computeKeyIdentity(opts.key, opts.tenantProviderId, opts.keyLabel);
    const bucket = this.getOrCreateBucket(
      opts.provider,
      opts.model,
      modelFamily,
      keyIdentity,
      opts.keyLabel,
    );

    this.pruneMinuteEntries(bucket, now);
    this.checkDailyReset(bucket, now);

    // 1. Check active freeze/cooldown
    if (bucket.frozenUntil && bucket.frozenUntil > now) {
      const retryAfterMs = bucket.frozenUntil - now;
      const reason =
        bucket.freezeReason ||
        `Temporary freeze active for ${opts.provider}/${opts.model} (key: ${bucket.keyLabel})`;
      return {
        allowed: false,
        reason,
        ruleType: 'cooldown',
        retryAfterMs,
        modelFamily,
      };
    }
    if (bucket.frozenUntil && bucket.frozenUntil <= now) {
      bucket.frozenUntil = null;
      bucket.freezeReason = null;
    }

    if (!rule) {
      return { allowed: true, modelFamily };
    }

    const estimated = opts.estimatedTokens ?? 0;
    const label = bucket.keyLabel || 'default';
    const displayModel = rule.displayName || opts.model;

    // 2. Check single request token limit
    if (rule.maxSingleRequestTokens && estimated > rule.maxSingleRequestTokens) {
      const reason =
        `Pre-flight skip: request estimated at ~${estimated.toLocaleString()} input tokens, ` +
        `exceeding the ${rule.maxSingleRequestTokens.toLocaleString()} limit for ${displayModel}.`;
      return {
        allowed: false,
        reason,
        ruleType: 'single_request_tokens',
        modelFamily,
      };
    }

    // 3. Check daily RPD (Requests Per Day)
    if (rule.maxRpd && bucket.dailyRequests >= rule.maxRpd) {
      const msUntilMidnight = getMsUntilMidnightUtc(now);
      const reason =
        `Pre-flight skip: daily quota exhausted (${bucket.dailyRequests} / ` +
        `${rule.maxRpd} RPD today) for key "${label}" on ${displayModel}. Resets at midnight UTC.`;
      return {
        allowed: false,
        reason,
        ruleType: 'rpd',
        retryAfterMs: msUntilMidnight,
        modelFamily,
      };
    }

    // 4. Check rolling 60-second TPM (Tokens Per Minute)
    const tpmUsed = this.calculateTpmUsed(bucket);
    if (rule.maxTpm && tpmUsed + estimated > rule.maxTpm) {
      const reason =
        `Pre-flight skip: 1-minute token quota exceeded (${(tpmUsed + estimated).toLocaleString()} / ` +
        `${rule.maxTpm.toLocaleString()} TPM) for key "${label}" on ${displayModel}.`;
      return {
        allowed: false,
        reason,
        ruleType: 'tpm',
        retryAfterMs: MINUTE_WINDOW_MS,
        modelFamily,
      };
    }

    // 5. Check rolling 60-second RPM (Requests Per Minute)
    const rpmUsed = bucket.minuteEntries.length;
    if (rule.maxRpm && rpmUsed >= rule.maxRpm) {
      const reason =
        `Pre-flight skip: 1-minute request rate limit reached (${rpmUsed} / ` +
        `${rule.maxRpm} RPM) for key "${label}" on ${displayModel}.`;
      return {
        allowed: false,
        reason,
        ruleType: 'rpm',
        retryAfterMs: MINUTE_WINDOW_MS,
        modelFamily,
      };
    }

    return { allowed: true, modelFamily };
  }

  /**
   * Record a successful provider call and update live TPM, RPM, and RPD sliding counters.
   */
  recordAttemptSuccess(opts: {
    provider: string;
    model: string;
    key?: string;
    tenantProviderId?: string | null;
    keyLabel?: string;
    inputTokens?: number;
  }): void {
    const now = Date.now();
    const rule = findQuotaRule(opts.provider, opts.model);
    const modelFamily = rule?.modelFamily ?? this.inferModelFamily(opts.model);
    const keyIdentity = computeKeyIdentity(opts.key, opts.tenantProviderId, opts.keyLabel);
    const bucket = this.getOrCreateBucket(
      opts.provider,
      opts.model,
      modelFamily,
      keyIdentity,
      opts.keyLabel,
    );

    this.pruneMinuteEntries(bucket, now);
    this.checkDailyReset(bucket, now);

    const tokens = Math.max(1, opts.inputTokens ?? 1);
    bucket.minuteEntries.push({ timestamp: now, tokens });
    bucket.dailyRequests += 1;
    bucket.lastUsedAt = now;
    bucket.consecutiveUnexpected429s = 0;
  }

  /**
   * Record a failed provider attempt and apply intelligent adaptive cooldowns/freezes.
   */
  recordAttemptFailure(opts: {
    provider: string;
    model: string;
    key?: string;
    tenantProviderId?: string | null;
    keyLabel?: string;
    status: number;
    errorBody?: string;
    retryAfterMs?: number;
  }): void {
    if (opts.status !== 429) return;

    const now = Date.now();
    const rule = findQuotaRule(opts.provider, opts.model);
    const modelFamily = rule?.modelFamily ?? this.inferModelFamily(opts.model);
    const keyIdentity = computeKeyIdentity(opts.key, opts.tenantProviderId, opts.keyLabel);
    const bucket = this.getOrCreateBucket(
      opts.provider,
      opts.model,
      modelFamily,
      keyIdentity,
      opts.keyLabel,
    );

    this.pruneMinuteEntries(bucket, now);
    this.checkDailyReset(bucket, now);
    bucket.lastUsedAt = now;

    const errorText = (opts.errorBody || '').toLowerCase();
    const label = bucket.keyLabel || 'default';
    const displayModel = rule?.displayName || opts.model;

    const isDailyQuotaError =
      errorText.includes('requests per day') ||
      errorText.includes('per day') ||
      errorText.includes('daily limit') ||
      errorText.includes('daily quota') ||
      errorText.includes('rpd');

    const isMinuteQuotaError =
      errorText.includes('requests per minute') ||
      errorText.includes('tokens per minute') ||
      errorText.includes('per minute') ||
      errorText.includes('rpm') ||
      errorText.includes('tpm');

    if (isDailyQuotaError) {
      if (rule?.maxRpd) {
        bucket.dailyRequests = Math.max(bucket.dailyRequests, rule.maxRpd);
      }
      const msUntilMidnight = getMsUntilMidnightUtc(now);
      bucket.frozenUntil = now + msUntilMidnight;
      bucket.freezeReason = `Daily quota exhausted (from provider 429 response) for key "${label}" on ${displayModel}. Resets at midnight UTC.`;
      this.logger.warn(
        `Daily quota exhausted for provider=${opts.provider} model=${opts.model} key=${label}. Freezing until midnight.`,
      );
      return;
    }

    if (isMinuteQuotaError || opts.retryAfterMs) {
      const cooldownMs = opts.retryAfterMs || MINUTE_WINDOW_MS;
      bucket.frozenUntil = now + cooldownMs;
      bucket.freezeReason = `Rate limited (RPM/TPM burst) for key "${label}" on ${displayModel}. Cooling down for ${Math.ceil(cooldownMs / 1000)}s.`;
      return;
    }

    // Heuristic for unexpected 429 when local RPM & TPM are well within limits:
    const rpmUsed = bucket.minuteEntries.length;
    const tpmUsed = this.calculateTpmUsed(bucket);
    const maxRpm = rule?.maxRpm ?? 5;
    const maxTpm = rule?.maxTpm ?? 250_000;
    const maxRpd = rule?.maxRpd ?? 20;

    const isWithinMinuteLimits = rpmUsed < maxRpm && tpmUsed < maxTpm;

    if (isWithinMinuteLimits) {
      bucket.consecutiveUnexpected429s += 1;
      const remainingDaily = Math.max(0, maxRpd - bucket.dailyRequests);

      // If we see repeated non-burst 429s or if consecutive failures exceed remaining budget:
      if (
        bucket.consecutiveUnexpected429s >= 2 ||
        bucket.consecutiveUnexpected429s >= remainingDaily
      ) {
        bucket.dailyRequests = maxRpd;
        const msUntilMidnight = getMsUntilMidnightUtc(now);
        bucket.frozenUntil = now + msUntilMidnight;
        bucket.freezeReason = `Inferred daily quota exhaustion from untracked external activity for key "${label}" on ${displayModel}. Freezing until midnight UTC.`;
        this.logger.warn(
          `Inferred daily quota exhaustion for provider=${opts.provider} model=${opts.model} key=${label} after ${bucket.consecutiveUnexpected429s} non-burst 429s.`,
        );
        return;
      }
    }

    // Default short burst cooldown
    const cooldownMs = opts.retryAfterMs || MINUTE_WINDOW_MS;
    bucket.frozenUntil = now + cooldownMs;
    bucket.freezeReason = `Upstream rate limit (429) for key "${label}" on ${displayModel}. Cooling down for ${Math.ceil(cooldownMs / 1000)}s.`;
  }

  /**
   * Return live snapshot of all tracked quota buckets across all providers and keys.
   */
  getAllBucketStatuses(): KeyQuotaBucketStatus[] {
    const now = Date.now();
    const result: KeyQuotaBucketStatus[] = [];

    for (const bucket of this.buckets.values()) {
      this.pruneMinuteEntries(bucket, now);
      this.checkDailyReset(bucket, now);

      const rule = findQuotaRule(bucket.provider, bucket.model);
      const rpmUsed = bucket.minuteEntries.length;
      const tpmUsed = this.calculateTpmUsed(bucket);
      const isFrozen = Boolean(bucket.frozenUntil && bucket.frozenUntil > now);
      const isExhausted = Boolean(
        (rule?.maxRpd && bucket.dailyRequests >= rule.maxRpd) ||
        (bucket.freezeReason && bucket.freezeReason.includes('Daily quota')),
      );

      let status: 'active' | 'cooldown' | 'exhausted' = 'active';
      if (isExhausted) {
        status = 'exhausted';
      } else if (isFrozen) {
        status = 'cooldown';
      }

      result.push({
        provider: bucket.provider,
        model: bucket.model,
        modelFamily: bucket.modelFamily,
        keyLabel: bucket.keyLabel,
        keyIdentity: bucket.keyIdentity,
        rpmUsed,
        rpmLimit: rule?.maxRpm ?? null,
        tpmUsed,
        tpmLimit: rule?.maxTpm ?? null,
        rpdUsed: bucket.dailyRequests,
        rpdLimit: rule?.maxRpd ?? null,
        frozenUntil: isFrozen ? bucket.frozenUntil : null,
        freezeReason: isFrozen ? bucket.freezeReason : null,
        status,
        lastUsedAt: bucket.lastUsedAt ? new Date(bucket.lastUsedAt).toISOString() : null,
      });
    }

    return result.sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
    );
  }

  private getOrCreateBucket(
    provider: string,
    model: string,
    modelFamily: string,
    keyIdentity: string,
    keyLabel?: string,
  ): KeyQuotaBucket {
    const key = `${provider.toLowerCase()}:${modelFamily}:${keyIdentity}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        provider: provider.toLowerCase(),
        model,
        modelFamily,
        keyLabel: keyLabel && keyLabel.length > 0 ? keyLabel : 'Default',
        keyIdentity,
        minuteEntries: [],
        dailyDayKey: getUtcDayKey(),
        dailyRequests: 0,
        frozenUntil: null,
        freezeReason: null,
        consecutiveUnexpected429s: 0,
        lastUsedAt: null,
      };
      this.buckets.set(key, bucket);
    } else if (keyLabel && keyLabel !== 'Default' && bucket.keyLabel === 'Default') {
      bucket.keyLabel = keyLabel;
    }
    return bucket;
  }

  private pruneMinuteEntries(bucket: KeyQuotaBucket, now: number): void {
    const cutoff = now - MINUTE_WINDOW_MS;
    if (bucket.minuteEntries.length > 0 && bucket.minuteEntries[0].timestamp < cutoff) {
      bucket.minuteEntries = bucket.minuteEntries.filter((e) => e.timestamp >= cutoff);
    }
  }

  private checkDailyReset(bucket: KeyQuotaBucket, now: number): void {
    const today = getUtcDayKey(new Date(now));
    if (bucket.dailyDayKey !== today) {
      bucket.dailyDayKey = today;
      bucket.dailyRequests = 0;
      bucket.consecutiveUnexpected429s = 0;
      if (
        bucket.freezeReason?.includes('Daily quota') ||
        bucket.freezeReason?.includes('daily quota')
      ) {
        bucket.frozenUntil = null;
        bucket.freezeReason = null;
      }
    }
  }

  private calculateTpmUsed(bucket: KeyQuotaBucket): number {
    return bucket.minuteEntries.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  private inferModelFamily(model: string): string {
    const lower = model.toLowerCase();
    if (lower.includes('flash-lite') || lower.includes('flash-8b')) return 'gemini-flash-lite';
    if (lower.includes('flash')) return 'gemini-flash';
    if (lower.includes('pro')) return 'gemini-pro';
    return model;
  }

  private evictExpiredBuckets(): void {
    const now = Date.now();
    const inactiveThreshold = now - 24 * 60 * 60 * 1000; // 24 hours of total inactivity

    for (const [key, bucket] of this.buckets) {
      this.pruneMinuteEntries(bucket, now);
      this.checkDailyReset(bucket, now);

      if (
        bucket.minuteEntries.length === 0 &&
        bucket.dailyRequests === 0 &&
        (!bucket.frozenUntil || bucket.frozenUntil <= now) &&
        (!bucket.lastUsedAt || bucket.lastUsedAt < inactiveThreshold)
      ) {
        this.buckets.delete(key);
      }
    }
  }
}
