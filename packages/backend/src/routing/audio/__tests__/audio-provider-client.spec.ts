import { AudioProviderClient } from '../audio-provider-client';
import { audioFieldsFromBody, type AudioUpload } from '../audio-validation';

const file: AudioUpload = {
  buffer: Buffer.from('fake audio bytes'),
  size: 16,
  filename: 'clip.mp3',
  contentType: 'audio/mpeg',
};

const verbose = {
  text: 'Buongiorno a tutti.',
  duration: 12.5,
  language: 'italian',
  segments: [
    { start: 0, end: 2.5, text: 'Buongiorno' },
    { start: 2.5, end: 5, text: 'a tutti.' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AudioProviderClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env['GROQ_AUDIO_BASE_URL'];
  });

  it('forwards a Groq transcription and extracts duration from verbose_json', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(verbose));
    const client = new AudioProviderClient();

    const result = await client.forward({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'whisper-large-v3',
      apiMode: 'transcriptions',
      fields: { ...audioFieldsFromBody({ language: 'it' }), responseFormat: 'json' },
      file,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: 'Buongiorno a tutti.' });
    expect(result.seconds).toBe(12.5);
    expect(result.result?.language).toBe('italian');
    expect(result.result?.segments).toHaveLength(2);
    expect(result.requestUrl).toBe('https://api.groq.com/openai/v1/audio/transcriptions');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Authorization: 'Bearer gsk_test' });
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('language')).toBe('it');
    expect(form.get('timestamp_granularities[]')).toBe('segment');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('projects the same transcript to text, srt and vtt', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => jsonResponse(verbose));
    const client = new AudioProviderClient();
    const base = {
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'whisper-large-v3',
      apiMode: 'transcriptions' as const,
      file,
    };

    const text = await client.forward({
      ...base,
      fields: { responseFormat: 'text' },
    });
    expect(text.body).toBe('Buongiorno a tutti.');

    const srt = await client.forward({ ...base, fields: { responseFormat: 'srt' } });
    expect(srt.body).toContain('1\n00:00:00,000 --> 00:00:02,500\nBuongiorno');
    expect(srt.body).toContain('2\n00:00:02,500 --> 00:00:05,000\na tutti.');

    const vtt = await client.forward({ ...base, fields: { responseFormat: 'vtt' } });
    expect(vtt.body).toContain('WEBVTT');
    expect(vtt.body).toContain('00:00:00.000 --> 00:00:02.500');

    const full = await client.forward({ ...base, fields: { responseFormat: 'verbose_json' } });
    expect(full.body).toEqual(verbose);
  });

  it('uses the translations path and omits language', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(verbose));
    const client = new AudioProviderClient();
    await client.forward({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'whisper-large-v3',
      apiMode: 'translations',
      fields: { responseFormat: 'json', language: 'it' },
      file,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.groq.com/openai/v1/audio/translations');
    expect((fetchMock.mock.calls[0]?.[1]?.body as FormData).get('language')).toBeNull();
  });

  it('forwards a URL instead of a file when no upload was provided', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(verbose));
    const client = new AudioProviderClient();
    await client.forward({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'whisper-large-v3',
      apiMode: 'transcriptions',
      fields: { responseFormat: 'json', url: 'https://example.com/clip.mp3' },
    });
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('url')).toBe('https://example.com/clip.mp3');
    expect(form.get('file')).toBeNull();
  });

  it('surfaces provider errors with their status and message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ error: { message: 'invalid model' } }, 400));
    const client = new AudioProviderClient();
    const result = await client.forward({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'nope',
      apiMode: 'transcriptions',
      fields: { responseFormat: 'json' },
      file,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.errorMessage).toBe('invalid model');
  });

  it('honours the base URL override for self-hosted/mock upstreams', async () => {
    process.env['GROQ_AUDIO_BASE_URL'] = 'http://localhost:9999/v1';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(verbose));
    const client = new AudioProviderClient();
    await client.forward({
      provider: 'groq',
      apiKey: 'gsk_test',
      model: 'whisper-large-v3',
      apiMode: 'transcriptions',
      fields: { responseFormat: 'json' },
      file,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:9999/v1/audio/transcriptions');
  });

  it('rejects a provider with no OpenAI-compatible audio surface', async () => {
    const client = new AudioProviderClient();
    const result = await client.forward({
      provider: 'anthropic',
      apiKey: 'key',
      model: 'whisper-large-v3',
      apiMode: 'transcriptions',
      fields: { responseFormat: 'json' },
      file,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.errorMessage).toBe('unsupported audio provider');
  });
});
