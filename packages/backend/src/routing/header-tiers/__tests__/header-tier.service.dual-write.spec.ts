import { Repository } from 'typeorm';
import { HeaderTierService } from '../header-tier.service';
import { HeaderTier } from '../../../entities/header-tier.entity';
import { RoutingCacheService } from '../../routing-core/routing-cache.service';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { DiscoveredModel } from '../../../model-discovery/model-fetcher';

/**
 * Header-tier dual-write invariants. HeaderTier is special: it has no
 * auto-assigned slot (header tiers are always user-configured), so we only
 * need to lock override_route and fallback_routes here.
 */

function makeDiscoveredModel(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    authType: 'api_key',
    contextWindow: 128000,
    inputPricePerToken: 0.000005,
    outputPricePerToken: 0.000015,
    capabilityReasoning: false,
    capabilityCode: true,
    qualityScore: 4,
    ...overrides,
  } as DiscoveredModel;
}

type Repo = jest.Mocked<
  Pick<Repository<HeaderTier>, 'find' | 'findOne' | 'insert' | 'save' | 'delete'>
>;

function makeRepo(): Repo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockImplementation((x) => Promise.resolve(x)),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as Repo;
}

function makeCache() {
  return {
    getHeaderTiers: jest.fn().mockReturnValue(null),
    setHeaderTiers: jest.fn(),
    invalidateAgent: jest.fn(),
  } as unknown as jest.Mocked<RoutingCacheService>;
}

function makeDiscovery(models: DiscoveredModel[] = []): jest.Mocked<ModelDiscoveryService> {
  return {
    getModelsForAgent: jest.fn().mockResolvedValue(models),
  } as unknown as jest.Mocked<ModelDiscoveryService>;
}

function makeService(models?: DiscoveredModel[]) {
  const repo = makeRepo();
  const cache = makeCache();
  const discovery = makeDiscovery(
    models ?? [
      makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
      makeDiscoveredModel({
        id: 'claude-3-haiku',
        provider: 'anthropic',
        authType: 'api_key',
      }),
    ],
  );
  const svc = new HeaderTierService(repo as unknown as Repository<HeaderTier>, cache, discovery);
  return { svc, repo, cache, discovery };
}

function makeRow(overrides: Partial<HeaderTier> = {}): HeaderTier {
  return Object.assign(new HeaderTier(), {
    id: 'h1',
    agent_id: 'a1',
    name: 'Premium',
    header_key: 'x-manifest-tier',
    header_value: 'premium',
    badge_color: 'indigo',
    sort_order: 0,
    enabled: true,
    override_model: null,
    override_provider: null,
    override_auth_type: null,
    fallback_models: null,
    override_route: null,
    fallback_routes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  });
}

describe('HeaderTierService — dual-write invariants', () => {
  describe('setOverride — explicit triple', () => {
    it('writes legacy fields AND override_route together when caller passes the triple', async () => {
      const { svc, repo } = makeService();
      const existing = makeRow();
      repo.findOne.mockResolvedValue(existing);

      const out = await svc.setOverride('a1', 'h1', 'gpt-4o', 'OpenAI', 'api_key');

      expect(out.override_model).toBe('gpt-4o');
      expect(out.override_provider).toBe('OpenAI');
      expect(out.override_auth_type).toBe('api_key');
      expect(out.override_route).toEqual({
        provider: 'OpenAI',
        authType: 'api_key',
        model: 'gpt-4o',
      });
    });
  });

  describe('setOverride — discovery-resolved route', () => {
    it('populates override_route when discovery returns a single match', async () => {
      const { svc, repo } = makeService();
      const existing = makeRow();
      repo.findOne.mockResolvedValue(existing);

      await svc.setOverride('a1', 'h1', 'gpt-4o');

      expect(existing.override_model).toBe('gpt-4o');
      expect(existing.override_provider).toBe('openai');
      expect(existing.override_auth_type).toBe('api_key');
      expect(existing.override_route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
    });

    it('leaves override_route null on ambiguous discovery (legacy stays authoritative)', async () => {
      const { svc, repo } = makeService([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'azure', authType: 'api_key' }),
      ]);
      const existing = makeRow();
      repo.findOne.mockResolvedValue(existing);

      await svc.setOverride('a1', 'h1', 'gpt-4o');

      expect(existing.override_model).toBe('gpt-4o');
      expect(existing.override_route).toBeNull();
    });
  });

  describe('clearOverride', () => {
    it('clears every override + route column on the row', async () => {
      const { svc, repo } = makeService();
      repo.findOne.mockResolvedValue(
        makeRow({
          override_model: 'gpt-4o',
          override_provider: 'openai',
          override_auth_type: 'api_key',
          fallback_models: ['claude'],
          override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
          fallback_routes: [{ provider: 'anthropic', authType: 'api_key', model: 'claude' }],
        }),
      );

      await svc.clearOverride('a1', 'h1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          override_model: null,
          override_provider: null,
          override_auth_type: null,
          fallback_models: null,
          override_route: null,
          fallback_routes: null,
        }),
      );
    });
  });

  describe('setFallbacks', () => {
    it('writes fallback_routes aligned with fallback_models when discovery resolves every entry', async () => {
      const { svc, repo } = makeService();
      const existing = makeRow();
      repo.findOne.mockResolvedValue(existing);

      await svc.setFallbacks('a1', 'h1', ['gpt-4o', 'claude-3-haiku']);

      expect(existing.fallback_models).toEqual(['gpt-4o', 'claude-3-haiku']);
      expect(existing.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('leaves fallback_routes null when ANY entry is ambiguous', async () => {
      const { svc, repo } = makeService([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'azure', authType: 'api_key' }),
        makeDiscoveredModel({
          id: 'claude-3-haiku',
          provider: 'anthropic',
          authType: 'api_key',
        }),
      ]);
      const existing = makeRow();
      repo.findOne.mockResolvedValue(existing);

      await svc.setFallbacks('a1', 'h1', ['gpt-4o', 'claude-3-haiku']);

      expect(existing.fallback_routes).toBeNull();
    });

    it('persists caller-supplied routes verbatim when aligned and validated against discovery', async () => {
      const { svc, repo, discovery } = makeService();
      const existing = makeRow();
      repo.findOne.mockResolvedValue(existing);
      const routes = [
        { provider: 'openai', authType: 'subscription' as const, model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key' as const, model: 'claude-3-haiku' },
      ];
      discovery.getModelsForAgent.mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'subscription' }),
        makeDiscoveredModel({ id: 'claude-3-haiku', provider: 'anthropic', authType: 'api_key' }),
      ]);

      await svc.setFallbacks('a1', 'h1', ['gpt-4o', 'claude-3-haiku'], routes);

      expect(existing.fallback_routes).toBe(routes);
      expect(discovery.getModelsForAgent).toHaveBeenCalled();
    });

    it('falls back to discovery when caller routes are misaligned', async () => {
      const { svc, repo, discovery } = makeService();
      const existing = makeRow();
      repo.findOne.mockResolvedValue(existing);

      await svc.setFallbacks(
        'a1',
        'h1',
        ['gpt-4o', 'claude-3-haiku'],
        [
          { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
          { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        ],
      );

      expect(discovery.getModelsForAgent).toHaveBeenCalled();
      expect(existing.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('clears fallback_routes to null when the empty list is set', async () => {
      const { svc, repo } = makeService();
      const existing = makeRow({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      });
      repo.findOne.mockResolvedValue(existing);

      await svc.setFallbacks('a1', 'h1', []);

      expect(existing.fallback_models).toBeNull();
      expect(existing.fallback_routes).toBeNull();
    });
  });

  describe('clearFallbacks', () => {
    it('clears legacy fallback_models AND fallback_routes', async () => {
      const { svc, repo } = makeService();
      const existing = makeRow({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      });
      repo.findOne.mockResolvedValue(existing);

      await svc.clearFallbacks('a1', 'h1');

      expect(existing.fallback_models).toBeNull();
      expect(existing.fallback_routes).toBeNull();
    });
  });
});
