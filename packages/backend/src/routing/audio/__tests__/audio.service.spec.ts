import { AudioService } from '../audio.service';
import type { AudioProviderClient } from '../audio-provider-client';
import type { AudioUpload } from '../audio-validation';

const ctx = { tenantId: 't1', agentId: 'a1', agentName: 'agent', userId: 'u1' };
const file: AudioUpload = {
  buffer: Buffer.from('audio'),
  size: 5,
  filename: 'clip.mp3',
  contentType: 'audio/mpeg',
};

function errorMessage(body: unknown): string {
  return (body as { error?: { message?: string } } | null)?.error?.message ?? '';
}

function taskIdOf(body: unknown): string {
  return (body as { id?: string } | null)?.id ?? '';
}

const transcript = {
  text: 'Buongiorno a tutti.',
  duration: 12.5,
  language: 'italian',
  segments: [{ start: 0, end: 2.5, text: 'Buongiorno' }],
};

function build(
  overrides: {
    discovery?: Record<string, jest.Mock>;
    audioClient?: Partial<Record<keyof AudioProviderClient, jest.Mock>>;
    recorder?: Record<string, jest.Mock>;
    requestRepo?: Record<string, jest.Mock>;
    messageRepo?: Record<string, jest.Mock>;
  } = {},
) {
  const providerKeyService = {
    selectProviderKey: jest
      .fn()
      .mockResolvedValue({ id: 'tp1', apiKey: 'gsk_test', label: 'Default' }),
    getProviderApiKey: jest.fn().mockResolvedValue({ apiKey: 'gsk_test' }),
  };
  const modelDiscovery = {
    getModelsForAgent: jest.fn().mockResolvedValue([
      {
        id: 'whisper-large-v3',
        provider: 'groq',
        authType: 'api_key',
        inputModalities: ['audio'],
        outputModalities: ['text'],
        supportedEndpoints: ['/v1/audio/transcriptions', '/v1/audio/translations'],
      },
      {
        id: 'llama-3.3-70b',
        provider: 'groq',
        authType: 'api_key',
        outputModalities: ['text'],
      },
    ]),
    ...overrides.discovery,
  };
  const audioClient = {
    forward: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { text: transcript.text },
      requestUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
      result: transcript,
      seconds: 12.5,
    }),
    ...overrides.audioClient,
  };
  const recorder = {
    recordPendingRequest: jest.fn().mockResolvedValue(undefined),
    recordPendingProviderAttempt: jest.fn().mockResolvedValue(true),
    completePendingProviderFailure: jest.fn().mockResolvedValue(undefined),
    recordSuccessMessage: jest.fn().mockResolvedValue(undefined),
    recordProviderError: jest.fn().mockResolvedValue(undefined),
    recordManifestBlockedRequest: jest.fn().mockResolvedValue(undefined),
    ...overrides.recorder,
  };
  const rateLimiter = {
    checkLimit: jest.fn(),
    checkIpLimit: jest.fn(),
    acquireSlot: jest.fn(),
    releaseSlot: jest.fn(),
  };
  const planService = { assertWithinRequestLimit: jest.fn().mockResolvedValue(undefined) };
  const requestRepo = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.requestRepo,
  };
  const messageRepo = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.messageRepo,
  };

  const service = new AudioService(
    providerKeyService as never,
    modelDiscovery as never,
    audioClient as unknown as AudioProviderClient,
    recorder as never,
    rateLimiter as never,
    planService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    requestRepo as never,
    messageRepo as never,
  );

  return { service, audioClient, recorder, requestRepo, messageRepo, rateLimiter };
}

describe('AudioService', () => {
  it('routes a Whisper model, forwards, and records per-minute cost', async () => {
    const { service, audioClient, recorder } = build();
    const result = await service.handle({
      ctx,
      body: { model: 'groq/whisper-large-v3', language: 'it' },
      headers: {},
      file,
      apiMode: 'transcriptions',
    });

    expect(audioClient.forward).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'groq',
        model: 'whisper-large-v3',
        apiMode: 'transcriptions',
        apiKey: 'gsk_test',
        file,
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ text: transcript.text });
    const successOpts = recorder.recordSuccessMessage.mock.calls[0][5];
    expect(successOpts.apiMode).toBe('transcriptions');
    // 12.5s at $0.111/hour.
    expect(successOpts.costUsdOverride).toBeCloseTo(0.111 * (12.5 / 3600), 6);
  });

  it('rejects a chat model on the audio endpoint before any provider work (M304)', async () => {
    const { service, audioClient, recorder } = build();
    const result = await service.handle({
      ctx,
      body: { model: 'groq/llama-3.3-70b' },
      headers: {},
      file,
      apiMode: 'transcriptions',
    });
    expect(result.status).toBe(400);
    expect(errorMessage(result.body)).toContain('does not support /v1/audio/transcriptions');
    expect(audioClient.forward).not.toHaveBeenCalled();
    expect(recorder.recordManifestBlockedRequest).toHaveBeenCalled();
  });

  it('rejects an unknown model with M302', async () => {
    const { service, audioClient } = build();
    const result = await service.handle({
      ctx,
      body: { model: 'does-not-exist' },
      headers: {},
      file,
      apiMode: 'transcriptions',
    });
    expect(result.status).toBe(400);
    expect(errorMessage(result.body)).toContain('not available for this agent');
    expect(audioClient.forward).not.toHaveBeenCalled();
  });

  it('validates the body before contacting the provider', async () => {
    const { service, audioClient } = build();
    const result = await service.handle({
      ctx,
      body: { model: 'groq/whisper-large-v3' },
      headers: {},
      apiMode: 'transcriptions',
    });
    expect(result.status).toBe(400);
    expect(errorMessage(result.body)).toContain('audio file or url');
    expect(audioClient.forward).not.toHaveBeenCalled();
  });

  it('stores an async task and returns a pollable object', async () => {
    const { service, requestRepo } = build();
    const result = await service.handle({
      ctx,
      body: { model: 'groq/whisper-large-v3' },
      headers: {},
      file,
      apiMode: 'transcriptions',
      async: true,
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      object: 'audio.transcription',
      status: 'completed',
      model: 'whisper-large-v3',
      api_mode: 'transcriptions',
      result: transcript,
    });
    expect(taskIdOf(result.body)).toMatch(/^atr_/);
    const update = requestRepo.update.mock.calls[0];
    expect(update[1]).toMatchObject({ audio_task_id: taskIdOf(result.body) });
    expect(update[1].audio_result).toMatchObject({ model: 'whisper-large-v3', result: transcript });
  });

  it('reads a stored task back and finalizes cost when the create had none', async () => {
    const { service, messageRepo } = build({
      messageRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'am1',
          provider: 'groq',
          model: 'whisper-large-v3',
          cost_usd: null,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      requestRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'req1',
          tenant_id: 't1',
          agent_id: 'a1',
          audio_task_id: 'atr_1',
          audio_result: {
            model: 'whisper-large-v3',
            apiMode: 'transcriptions',
            createdAt: 1000,
            result: transcript,
          },
        }),
      },
    });

    const result = await service.taskStatus(ctx, 'atr_1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: 'atr_1', status: 'completed', result: transcript });
    expect(messageRepo.update).toHaveBeenCalledWith(
      { id: 'am1' },
      expect.objectContaining({ cost_usd: expect.any(Number) }),
    );
  });

  it('returns 404 for a task owned by another tenant or agent', async () => {
    const { service } = build({
      requestRepo: { findOne: jest.fn().mockResolvedValue(null) },
    });
    const result = await service.taskStatus(ctx, 'atr_missing');
    expect(result.status).toBe(404);
  });

  it('records a provider failure and returns its status', async () => {
    const { service, recorder } = build({
      audioClient: {
        forward: jest.fn().mockResolvedValue({
          ok: false,
          status: 429,
          body: { error: { message: 'rate limited' } },
          requestUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
          errorMessage: 'rate limited',
        }),
      },
    });
    const result = await service.handle({
      ctx,
      body: { model: 'groq/whisper-large-v3' },
      headers: {},
      file,
      apiMode: 'transcriptions',
    });
    expect(result.status).toBe(429);
    expect(errorMessage(result.body)).toBe('rate limited');
    expect(recorder.recordProviderError).toHaveBeenCalled();
  });
});
