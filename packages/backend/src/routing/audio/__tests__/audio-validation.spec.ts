import { audioFieldsFromBody, validateAudioRequest, type AudioUpload } from '../audio-validation';

const file: AudioUpload = {
  buffer: Buffer.from('audio'),
  size: 5,
  filename: 'clip.mp3',
  contentType: 'audio/mpeg',
};

describe('audioFieldsFromBody', () => {
  it('parses multipart string fields and flattens extra_body', () => {
    const fields = audioFieldsFromBody({
      model: 'whisper-large-v3',
      language: 'it',
      temperature: '0.2',
      extra_body: JSON.stringify({ prompt: 'Italian, punctuated' }),
    });
    expect(fields.language).toBe('it');
    expect(fields.temperature).toBe(0.2);
    expect(fields.responseFormat).toBe('json');
  });

  it('accepts an object extra_body and preserves an explicit response format', () => {
    const fields = audioFieldsFromBody({
      extra_body: { response_format: 'verbose_json', prompt: 'hint' },
    });
    expect(fields.responseFormat).toBe('verbose_json');
    expect(fields.prompt).toBe('hint');
  });
});

describe('validateAudioRequest', () => {
  const base = {
    provider: 'groq',
    apiMode: 'transcriptions' as const,
    model: 'whisper-large-v3',
    body: {},
    file,
    fields: audioFieldsFromBody({}),
  };

  it('accepts a well-formed request', () => {
    expect(validateAudioRequest(base)).toBeUndefined();
  });

  it('accepts a URL instead of an uploaded file', () => {
    expect(
      validateAudioRequest({
        ...base,
        file: undefined,
        fields: { ...base.fields, url: 'https://example.com/clip.mp3' },
      }),
    ).toBeUndefined();
  });

  it('rejects a missing file and URL', () => {
    expect(validateAudioRequest({ ...base, file: undefined })).toContain('audio file or url');
  });

  it('rejects an oversized file', () => {
    expect(validateAudioRequest({ ...base, file: { ...file, size: 26 * 1024 * 1024 } })).toContain(
      'too large',
    );
  });

  it('rejects an unsupported response format', () => {
    const body = { response_format: 'xml' };
    expect(
      validateAudioRequest({
        ...base,
        body,
        fields: audioFieldsFromBody(body),
      }),
    ).toContain('response_format');
  });

  it('rejects an out-of-range temperature', () => {
    expect(
      validateAudioRequest({
        ...base,
        fields: { ...base.fields, temperature: 1.5 },
      }),
    ).toContain('temperature');
  });

  it('rejects Groq turbo on the translations endpoint before contacting the provider', () => {
    expect(
      validateAudioRequest({
        ...base,
        apiMode: 'translations',
        model: 'whisper-large-v3-turbo',
      }),
    ).toContain('/v1/audio/translations');
    expect(
      validateAudioRequest({ ...base, apiMode: 'translations', model: 'whisper-large-v3' }),
    ).toBeUndefined();
  });
});
