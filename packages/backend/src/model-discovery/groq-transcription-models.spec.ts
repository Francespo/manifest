import {
  AUDIO_TRANSCRIPTION_ENDPOINT,
  AUDIO_TRANSLATION_ENDPOINT,
} from 'manifest-shared';
import {
  PROVIDER_CONFIGS,
  filterNonChatModels,
  isTranscriptionCapableProvider,
  isTranscriptionModel,
} from './provider-model-fetcher.service';

describe('Groq transcription discovery', () => {
  const listing = {
    data: [
      { id: 'llama-3.3-70b-versatile' },
      { id: 'whisper-large-v3-turbo' },
      { id: 'orpheus-3b-0.1-ft' },
    ],
  };

  it('registers Groq as transcription-capable', () => {
    expect(isTranscriptionCapableProvider('groq')).toBe(true);
    expect(isTranscriptionCapableProvider('openai')).toBe(false);
  });

  it('annotates live Whisper models with audio endpoints and modalities', () => {
    const models = PROVIDER_CONFIGS['groq']!.parse(listing, 'groq');
    const turbo = models.find((model) => model.id === 'whisper-large-v3-turbo');
    expect(turbo).toMatchObject({
      inputModalities: ['audio'],
      outputModalities: ['text'],
      supportedEndpoints: [AUDIO_TRANSCRIPTION_ENDPOINT],
    });
    expect(isTranscriptionModel(turbo!)).toBe(true);
  });

  it('appends curated Whisper models the live listing omitted', () => {
    const models = PROVIDER_CONFIGS['groq']!.parse(listing, 'groq');
    const large = models.find((model) => model.id === 'whisper-large-v3');
    expect(large).toBeDefined();
    expect(large?.supportedEndpoints).toEqual([
      AUDIO_TRANSCRIPTION_ENDPOINT,
      AUDIO_TRANSLATION_ENDPOINT,
    ]);
    expect(large?.displayName).toBe('Whisper Large v3');
  });

  it('keeps audio models in the non-chat filter while still dropping TTS models', () => {
    const models = PROVIDER_CONFIGS['groq']!.parse(listing, 'groq');
    const filtered = filterNonChatModels(models, 'groq');
    expect(filtered.map((model) => model.id)).toContain('whisper-large-v3-turbo');
    expect(filtered.map((model) => model.id)).toContain('whisper-large-v3');
    expect(filtered.map((model) => model.id)).not.toContain('orpheus-3b-0.1-ft');
    expect(filtered.map((model) => model.id)).toContain('llama-3.3-70b-versatile');
  });
});
