import {
  buildSelfHostedUsageConfig,
  DEFAULT_AGGREGATE_ENDPOINT,
  SelfHostedUsageService,
  type SelfHostedUsageConfig,
} from './self-hosted-usage.service';

jest.mock('../common/utils/detect-self-hosted', () => ({
  isSelfHosted: jest.fn(() => false),
}));

import { isSelfHosted } from '../common/utils/detect-self-hosted';
const isSelfHostedMock = isSelfHosted as jest.MockedFunction<typeof isSelfHosted>;

function makeService(overrides?: Partial<SelfHostedUsageConfig>): SelfHostedUsageService {
  const service = new SelfHostedUsageService();
  (service as unknown as { config: SelfHostedUsageConfig }).config = {
    enabled: overrides?.enabled ?? true,
    endpoint: overrides?.endpoint ?? 'http://aggregate.test/v1/aggregate/usage',
    apiKey: overrides?.apiKey ?? 'test-shared-secret',
  };
  return service;
}

describe('buildSelfHostedUsageConfig', () => {
  beforeEach(() => {
    isSelfHostedMock.mockReturnValue(false);
  });

  it('enables in production cloud mode when an aggregate key is set', () => {
    const cfg = buildSelfHostedUsageConfig({
      NODE_ENV: 'production',
      TELEMETRY_AGGREGATE_KEY: 'a-secret',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.endpoint).toBe(DEFAULT_AGGREGATE_ENDPOINT);
    expect(cfg.apiKey).toBe('a-secret');
  });

  it('reads TELEMETRY_AGGREGATE_ENDPOINT override', () => {
    const cfg = buildSelfHostedUsageConfig({
      NODE_ENV: 'production',
      TELEMETRY_AGGREGATE_KEY: 'a-secret',
      TELEMETRY_AGGREGATE_ENDPOINT: 'https://staging.example.com/v1/aggregate/usage',
    });
    expect(cfg.endpoint).toBe('https://staging.example.com/v1/aggregate/usage');
  });

  it('disables outside production', () => {
    expect(
      buildSelfHostedUsageConfig({
        NODE_ENV: 'development',
        TELEMETRY_AGGREGATE_KEY: 'a-secret',
      }).enabled,
    ).toBe(false);
    expect(buildSelfHostedUsageConfig({ TELEMETRY_AGGREGATE_KEY: 'a-secret' }).enabled).toBe(false);
  });

  it('disables on self-hosted instances even in production', () => {
    isSelfHostedMock.mockReturnValue(true);
    expect(
      buildSelfHostedUsageConfig({
        NODE_ENV: 'production',
        TELEMETRY_AGGREGATE_KEY: 'a-secret',
      }).enabled,
    ).toBe(false);
  });

  it('disables when TELEMETRY_AGGREGATE_KEY is unset', () => {
    expect(buildSelfHostedUsageConfig({ NODE_ENV: 'production' }).enabled).toBe(false);
  });

  it('disables when TELEMETRY_AGGREGATE_KEY is empty string', () => {
    expect(
      buildSelfHostedUsageConfig({
        NODE_ENV: 'production',
        TELEMETRY_AGGREGATE_KEY: '',
      }).enabled,
    ).toBe(false);
  });

  it('defaults to process.env when no env argument is given', () => {
    const cfg = buildSelfHostedUsageConfig();
    expect(typeof cfg.enabled).toBe('boolean');
    expect(typeof cfg.endpoint).toBe('string');
    expect(typeof cfg.apiKey).toBe('string');
  });
});

describe('SelfHostedUsageService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    isSelfHostedMock.mockReturnValue(false);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }): Response {
    return {
      ok: init?.ok ?? (init?.status ?? 200) < 400,
      status: init?.status ?? 200,
      json: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  it('returns null without calling fetch when disabled', async () => {
    const service = makeService({ enabled: false });

    const result = await service.fetchAggregate();

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the parsed messages_total on success', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: 12345 }));
    const service = makeService();

    const result = await service.fetchAggregate();

    expect(result).toEqual({ messages_total: 12345 });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://aggregate.test/v1/aggregate/usage',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('sends the configured aggregate key in the X-Aggregate-Key header', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: 1 }));
    const service = makeService({ apiKey: 'super-secret-value' });

    await service.fetchAggregate();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://aggregate.test/v1/aggregate/usage',
      expect.objectContaining({
        headers: { 'x-aggregate-key': 'super-secret-value' },
      }),
    );
  });

  it('coerces string-shaped messages_total to a number', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: '42' }));
    const service = makeService();

    const result = await service.fetchAggregate();

    expect(result).toEqual({ messages_total: 42 });
  });

  it('returns null when the endpoint responds non-2xx', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(null, { status: 503, ok: false }));
    const service = makeService();

    const result = await service.fetchAggregate();

    expect(result).toBeNull();
  });

  it('returns null when messages_total is missing', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null when messages_total is null', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: null }));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null when messages_total is an empty string', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: '' }));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null when messages_total is whitespace only', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: '   ' }));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null when messages_total is non-numeric', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: 'not-a-number' }));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null when messages_total is negative', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: -1 }));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null when messages_total is an unsupported type (boolean)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: true }));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null when fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('returns null on non-Error rejections (covers the String() branch)', async () => {
    fetchSpy.mockRejectedValue('plain string');
    const service = makeService();

    expect(await service.fetchAggregate()).toBeNull();
  });

  it('serves cached values within the TTL', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ messages_total: 100 }));
    const service = makeService();

    const a = await service.fetchAggregate();
    const b = await service.fetchAggregate();

    expect(b).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the cache expires', async () => {
    jest.useFakeTimers();
    try {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ messages_total: 100 }))
        .mockResolvedValueOnce(jsonResponse({ messages_total: 200 }));
      const service = makeService();

      const first = await service.fetchAggregate();
      jest.setSystemTime(Date.now() + 61_000);
      const second = await service.fetchAggregate();

      expect(first).toEqual({ messages_total: 100 });
      expect(second).toEqual({ messages_total: 200 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('dedupes concurrent callers onto a single in-flight fetch', async () => {
    let resolveFetch!: (r: Response) => void;
    fetchSpy.mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );
    const service = makeService();

    const p1 = service.fetchAggregate();
    const p2 = service.fetchAggregate();
    resolveFetch(jsonResponse({ messages_total: 7 }));
    const [a, b] = await Promise.all([p1, p2]);

    expect(a).toEqual({ messages_total: 7 });
    expect(b).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caches failures for 30s — repeated calls during an outage do not re-fetch', async () => {
    jest.useFakeTimers();
    try {
      fetchSpy.mockRejectedValue(new Error('boom'));
      const service = makeService();

      const first = await service.fetchAggregate();
      jest.setSystemTime(Date.now() + 5_000);
      const second = await service.fetchAggregate();
      jest.setSystemTime(Date.now() + 20_000);
      const third = await service.fetchAggregate();

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(third).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries after the failure cache expires', async () => {
    jest.useFakeTimers();
    try {
      fetchSpy
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(jsonResponse({ messages_total: 5 }));
      const service = makeService();

      const first = await service.fetchAggregate();
      jest.setSystemTime(Date.now() + 31_000);
      const second = await service.fetchAggregate();

      expect(first).toBeNull();
      expect(second).toEqual({ messages_total: 5 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('aborts the request when the fetch outlasts the 2s timeout', async () => {
    let aborted = false;
    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal!;
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );
    jest.useFakeTimers();
    try {
      const service = makeService();
      const promise = service.fetchAggregate();
      jest.advanceTimersByTime(3000);
      const result = await promise;

      expect(result).toBeNull();
      expect(aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
