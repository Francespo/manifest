export interface ModelQuotaRule {
  provider: string;
  modelPattern: RegExp;
  modelFamily: string;
  displayName?: string;
  maxSingleRequestTokens?: number;
  maxTpm?: number;
  maxRpm?: number;
  maxRpd?: number;
}

export type QuotaRuleType =
  'single_request_tokens' | 'tpm' | 'rpm' | 'rpd' | 'cooldown' | 'inferred_daily_exhaustion';

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  ruleType?: QuotaRuleType;
  retryAfterMs?: number;
  modelFamily?: string;
}

export interface QuotaUsageWindowEntry {
  timestamp: number;
  tokens: number;
}

export interface KeyQuotaBucket {
  provider: string;
  model: string;
  modelFamily: string;
  keyLabel: string;
  keyIdentity: string;
  // Sliding 60s window
  minuteEntries: QuotaUsageWindowEntry[];
  // Daily count
  dailyDayKey: string; // YYYY-MM-DD (UTC)
  dailyRequests: number;
  // Dynamic cooldown/freeze
  frozenUntil: number | null;
  freezeReason: string | null;
  // Consecutive unexpected 429 failures while within local RPM/TPM limits
  consecutiveUnexpected429s: number;
  lastUsedAt: number | null;
}
