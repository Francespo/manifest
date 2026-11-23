import { audioCostProjection, audioCostUsd } from '../audio-pricing';

describe('audio pricing', () => {
  it('prices Groq Whisper models per audio minute', () => {
    // List prices are per audio hour: $0.04/h → $0.000666…/min.
    expect(audioCostUsd('groq', 'whisper-large-v3-turbo', 60)).toBeCloseTo(0.04 / 60, 6);
    expect(audioCostUsd('groq', 'whisper-large-v3', 60)).toBeCloseTo(0.111 / 60, 6);
    expect(audioCostUsd('groq', 'whisper-large-v3-turbo', 30)).toBeCloseTo(0.04 / 120, 6);
  });

  it('applies Groq’s 10-second minimum billed length', () => {
    expect(audioCostUsd('groq', 'whisper-large-v3-turbo', 4)).toBeCloseTo(0.04 / 360, 6);
    expect(audioCostUsd('groq', 'whisper-large-v3-turbo', 10)).toBeCloseTo(0.04 / 360, 6);
    expect(audioCostUsd('groq', 'whisper-large-v3-turbo', 11)).toBeCloseTo((0.04 / 3600) * 11, 6);
  });

  it('returns null when the duration or the rate is unknown', () => {
    expect(audioCostUsd('groq', 'whisper-large-v3', undefined)).toBeNull();
    expect(audioCostUsd('groq', 'whisper-large-v3', 0)).toBeNull();
    expect(audioCostUsd('groq', 'unknown-whisper', 60)).toBeNull();
    expect(audioCostUsd('mistral', 'voxtral-mini', 60)).toBeNull();
  });

  it('projects a per-minute rate with the billing floor for /v1/models', () => {
    expect(audioCostProjection('groq', 'whisper-large-v3')).toEqual({
      unit: 'minute',
      rates: 0.111 / 60,
      minimumBillableSeconds: 10,
    });
    expect(audioCostProjection('openai', 'whisper-1')).toBeUndefined();
  });
});
