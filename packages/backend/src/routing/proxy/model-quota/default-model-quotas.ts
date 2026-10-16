import type { ModelQuotaRule } from './model-quota.types';

/**
 * Flash / Flash Lite families cover any current or future Flash version
 * (e.g. 2.0, 2.5, 2.5 Flash-Lite, 3.1 Pro variants are not captured).
 * Patterns are evaluated from the normalized model id (lowercase, no leading
 * "models/" prefix, no provider prefix segment). Keep them permissive so
 * new Gemini Flash(n) generations (3.x, 4.x, ...) are automatically buckets.
 */
export const DEFAULT_MODEL_QUOTA_RULES: ModelQuotaRule[] = [
  // Google Gemini Flash — future Flash(n) proof
  {
    provider: 'google',
    // Matches: gemini-flash, gemini-2.0-flash, gemini-3.7-flash, gemini-3-flash-preview (not -lite/-8b)
    modelPattern: /^gemini-(?:[0-9.]+-)?flash(?!(?:-lite|-8b))/i,
    modelFamily: 'gemini-flash',
    displayName: 'Google Gemini Flash',
    maxSingleRequestTokens: 250_000,
    maxTpm: 250_000,
    maxRpm: 5,
    maxRpd: 20,
  },
  {
    provider: 'gemini',
    modelPattern: /^gemini-(?:[0-9.]+-)?flash(?!(?:-lite|-8b))/i,
    modelFamily: 'gemini-flash',
    displayName: 'Google Gemini Flash',
    maxSingleRequestTokens: 250_000,
    maxTpm: 250_000,
    maxRpm: 5,
    maxRpd: 20,
  },
  // Google Gemini Flash Lite — future Flash Lite(n) proof (covers -lite and legacy -8b)
  {
    provider: 'google',
    modelPattern: /^gemini-(?:[0-9.]+-)?flash-(?:lite|8b)/i,
    modelFamily: 'gemini-flash-lite',
    displayName: 'Google Gemini Flash Lite',
    maxSingleRequestTokens: 250_000,
    maxTpm: 250_000,
    maxRpm: 15,
    maxRpd: 500,
  },
  {
    provider: 'gemini',
    modelPattern: /^gemini-(?:[0-9.]+-)?flash-(?:lite|8b)/i,
    modelFamily: 'gemini-flash-lite',
    displayName: 'Google Gemini Flash Lite',
    maxSingleRequestTokens: 250_000,
    maxTpm: 250_000,
    maxRpm: 15,
    maxRpd: 500,
  },
];

export function findQuotaRule(provider: string, model: string): ModelQuotaRule | null {
  const normProvider = provider.toLowerCase();
  // Strip any 'models/' prefix or provider prefix from model name
  let cleanModel = model.toLowerCase();
  if (cleanModel.startsWith('models/')) {
    cleanModel = cleanModel.slice(7);
  }
  const slashIdx = cleanModel.indexOf('/');
  if (slashIdx >= 0) {
    cleanModel = cleanModel.slice(slashIdx + 1);
  }

  for (const rule of DEFAULT_MODEL_QUOTA_RULES) {
    if (rule.provider.toLowerCase() === normProvider && rule.modelPattern.test(cleanModel)) {
      return rule;
    }
  }
  return null;
}
