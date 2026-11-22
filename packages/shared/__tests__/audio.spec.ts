import {
  AUDIO_ENDPOINTS,
  GROQ_AUDIO_PRICES,
  GROQ_TRANSCRIPTION_MODELS,
  SHARED_PROVIDER_BY_ID,
  isAudioEndpoint,
} from '../src/index';

describe('audio contracts', () => {
  it('publishes both OpenAI-compatible speech-to-text endpoints', () => {
    expect(AUDIO_ENDPOINTS).toEqual(['/v1/audio/transcriptions', '/v1/audio/translations']);
    expect(isAudioEndpoint('/v1/audio/transcriptions')).toBe(true);
    expect(isAudioEndpoint('/v1/images/generations')).toBe(false);
  });

  it('marks Groq as transcription-capable with both endpoints', () => {
    expect(SHARED_PROVIDER_BY_ID.get('groq')?.transcription).toEqual({
      transcriptions: true,
      translations: true,
    });
  });

  it('curates Groq Whisper models with their real endpoint support', () => {
    const turbo = GROQ_TRANSCRIPTION_MODELS.find((m) => m.id === 'whisper-large-v3-turbo');
    const large = GROQ_TRANSCRIPTION_MODELS.find((m) => m.id === 'whisper-large-v3');
    expect(turbo?.transcription).toBe(true);
    expect(turbo?.translation).toBe(false);
    expect(large?.transcription).toBe(true);
    expect(large?.translation).toBe(true);
  });

  it('prices audio per minute with Groq’s ten-second floor', () => {
    expect(GROQ_AUDIO_PRICES.minimumBillableSeconds).toBe(10);
    expect(GROQ_AUDIO_PRICES.audioPerMinute?.['whisper-large-v3-turbo']).toBeCloseTo(0.04 / 60, 8);
    expect(GROQ_AUDIO_PRICES.audioPerMinute?.['whisper-large-v3']).toBeCloseTo(0.111 / 60, 8);
  });
});
