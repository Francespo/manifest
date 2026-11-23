import { PROVIDER_AUDIO_PRICES } from 'manifest-shared';

/**
 * Speech-to-text is billed on audio duration, not tokens. Rates live in the
 * shared provider catalogs so the Gateway and the dashboard report the same
 * price; a provider with no table is "cost not tracked" (null), never free.
 */

export interface AudioCostProjection {
  unit: 'minute';
  /** USD per minute of audio. */
  rates: number;
  /** Provider floor, if any (Groq bills at least 10 seconds). */
  minimumBillableSeconds?: number;
}

/** Price advertised on `/v1/models?cost=true` for a speech-to-text model. */
export function audioCostProjection(
  provider: string,
  model: string,
): AudioCostProjection | undefined {
  const table = PROVIDER_AUDIO_PRICES[provider.toLowerCase()];
  if (!table) return undefined;
  const rates = table.audioPerMinute?.[model] ?? table.audioDefaultPerMinute;
  if (rates === undefined || !Number.isFinite(rates)) return undefined;
  return {
    unit: 'minute',
    rates,
    ...(table.minimumBillableSeconds !== undefined
      ? { minimumBillableSeconds: table.minimumBillableSeconds }
      : {}),
  };
}

/**
 * USD for `durationSeconds` of audio. Providers that floor the billed length
 * are honoured: a 4-second Groq clip costs the same as a 10-second clip.
 * `null` means the duration or the rate is unknown — no fabricated zero.
 */
export function audioCostUsd(
  provider: string,
  model: string,
  durationSeconds: number | undefined,
): number | null {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  const table = PROVIDER_AUDIO_PRICES[provider.toLowerCase()];
  if (!table) return null;
  const perMinute = table.audioPerMinute?.[model] ?? table.audioDefaultPerMinute;
  if (perMinute === undefined || !Number.isFinite(perMinute)) return null;
  const billableSeconds = Math.max(durationSeconds, table.minimumBillableSeconds ?? 0);
  return (perMinute / 60) * billableSeconds;
}
