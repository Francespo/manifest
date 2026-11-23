import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getModelCatalog, updateModelCatalog } from '../../../src/services/api/model-catalog';
import type { ModelCatalogResponse } from 'manifest-shared';

vi.mock('../../../src/services/toast-store.js', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const catalog: ModelCatalogResponse = {
  pool_model_ids: ['openai/gpt-4o'],
  custom_provider_ids: ['cp-1'],
  options: {
    pool_models: [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'anthropic/claude', label: 'Claude' },
    ],
    custom_providers: [
      { id: 'cp-1', label: 'Acme' },
      { id: 'cp-2', label: 'Beta' },
    ],
  },
};

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

describe('model catalog API client', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('GETs /model-catalog and returns the config with its options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(catalog));
    vi.stubGlobal('fetch', fetchMock);

    const out = await getModelCatalog();

    expect(out).toEqual(catalog);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost/api/v1/model-catalog');
    expect(init.credentials).toBe('include');
  });

  it('PATCHes /model-catalog with the partial config and returns the updated catalog', async () => {
    const updated: ModelCatalogResponse = {
      pool_model_ids: ['anthropic/claude'],
      custom_provider_ids: [],
      options: catalog.options,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated));
    vi.stubGlobal('fetch', fetchMock);
    const input = { pool_model_ids: ['anthropic/claude'], custom_provider_ids: [] };

    const out = await updateModelCatalog(input);

    expect(out).toEqual(updated);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/model-catalog');
    expect(init.method).toBe('PATCH');
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
