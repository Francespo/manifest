import { TierService } from '../tier.service';
import { TierAutoAssignService } from '../tier-auto-assign.service';
import { RoutingCacheService } from '../routing-cache.service';
import { ProviderService } from '../provider.service';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import { TierAssignment } from '../../../entities/tier-assignment.entity';

/**
 * Locks the dual-write invariants in TierService:
 *
 *  - setOverride writes legacy AND override_route together when the route is
 *    unambiguous; otherwise it persists legacy and leaves override_route null.
 *  - setFallbacks writes legacy AND fallback_routes together when EVERY model
 *    resolves unambiguously; otherwise fallback_routes stays null.
 *  - clearOverride / clearFallbacks / resetAllOverrides clear BOTH shapes so
 *    legacy and route never drift apart.
 *  - The existing dedup invariant (override removed from fallback list) still
 *    applies, and is mirrored on fallback_routes.
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

jest.mock('../../../common/utils/subscription-support', () => ({
  isManifestUsableProvider: jest.fn(() => true),
}));

function makeMockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: unknown) => Promise.resolve(entity)),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

function makeTier(overrides: Partial<TierAssignment> = {}): TierAssignment {
  return Object.assign(new TierAssignment(), {
    id: 'tier-1',
    user_id: 'user-1',
    agent_id: 'agent-1',
    tier: 'simple',
    override_model: null,
    override_provider: null,
    override_auth_type: null,
    auto_assigned_model: null,
    fallback_models: null,
    override_route: null,
    auto_assigned_route: null,
    fallback_routes: null,
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  });
}

describe('TierService — dual-write invariants', () => {
  let service: TierService;
  let providerRepo: ReturnType<typeof makeMockRepo>;
  let tierRepo: ReturnType<typeof makeMockRepo>;
  let autoAssign: { recalculate: jest.Mock };
  let routingCache: {
    getTiers: jest.Mock;
    setTiers: jest.Mock;
    invalidateAgent: jest.Mock;
    getProviders: jest.Mock;
    setProviders: jest.Mock;
  };
  let providerService: { getProviders: jest.Mock };
  let discoveryService: { getModelsForAgent: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    providerRepo = makeMockRepo();
    tierRepo = makeMockRepo();
    autoAssign = { recalculate: jest.fn().mockResolvedValue(undefined) };
    routingCache = {
      getTiers: jest.fn().mockReturnValue(null),
      setTiers: jest.fn(),
      invalidateAgent: jest.fn(),
      getProviders: jest.fn().mockReturnValue(null),
      setProviders: jest.fn(),
    };
    providerService = { getProviders: jest.fn().mockResolvedValue([]) };
    discoveryService = {
      getModelsForAgent: jest.fn().mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({
          id: 'claude-3-haiku',
          provider: 'anthropic',
          authType: 'api_key',
        }),
      ]),
    };

    service = new TierService(
      providerRepo as unknown as any,
      tierRepo as unknown as any,
      autoAssign as unknown as TierAutoAssignService,
      routingCache as unknown as RoutingCacheService,
      providerService as unknown as ProviderService,
      discoveryService as unknown as ModelDiscoveryService,
    );
  });

  describe('setOverride — explicit triple', () => {
    it('writes legacy fields AND override_route together when caller passes (model, provider, authType)', async () => {
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);

      const result = await service.setOverride(
        'agent-1',
        'user-1',
        'simple',
        'gpt-4o',
        'openai',
        'api_key',
      );

      expect(result.override_model).toBe('gpt-4o');
      expect(result.override_provider).toBe('openai');
      expect(result.override_auth_type).toBe('api_key');
      expect(result.override_route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
    });

    it('writes the same triple on insert path when no existing row', async () => {
      tierRepo.findOne.mockResolvedValue(null);

      const result = await service.setOverride(
        'agent-1',
        'user-1',
        'complex',
        'gpt-4o',
        'openai',
        'api_key',
      );

      expect(tierRepo.insert).toHaveBeenCalledTimes(1);
      const inserted = (tierRepo.insert.mock.calls[0][0] ?? result) as TierAssignment;
      expect(inserted.override_model).toBe('gpt-4o');
      expect(inserted.override_route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
    });
  });

  describe('setOverride — discovery-resolved route', () => {
    it('populates both shapes when the model resolves to a single (provider, authType) pair', async () => {
      // Caller passes only the model name; discovery returns exactly one
      // match. The dual-write should still produce override_route.
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'simple', 'gpt-4o');

      expect(existing.override_model).toBe('gpt-4o');
      expect(existing.override_provider).toBe('openai');
      expect(existing.override_auth_type).toBe('api_key');
      expect(existing.override_route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
    });

    it('persists legacy fields and leaves override_route null when discovery is ambiguous', async () => {
      // Same id served by two different providers. Without an explicit
      // provider hint there's no single route to commit to, so the legacy
      // path stays authoritative.
      discoveryService.getModelsForAgent.mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'azure', authType: 'api_key' }),
      ]);
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'simple', 'gpt-4o');

      expect(existing.override_model).toBe('gpt-4o');
      expect(existing.override_route).toBeNull();
    });

    it('leaves override_route null when discovery has no authType for the model', async () => {
      // A discovered entry without authType cannot form a complete route.
      discoveryService.getModelsForAgent.mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: undefined as any }),
      ]);
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'simple', 'gpt-4o');

      expect(existing.override_route).toBeNull();
    });
  });

  describe('setOverride — dedup against fallbacks', () => {
    it('removes the override model from fallback_models AND fallback_routes', async () => {
      const existing = makeTier({
        fallback_models: ['gpt-4o', 'claude-3-haiku'],
        fallback_routes: [
          { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
          { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
        ],
      });
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'simple', 'gpt-4o', 'openai', 'api_key');

      expect(existing.fallback_models).toEqual(['claude-3-haiku']);
      expect(existing.fallback_routes).toEqual([
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('compares fallback routes case-insensitively on provider when deduping', async () => {
      const existing = makeTier({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'OpenAI', authType: 'api_key', model: 'gpt-4o' }],
      });
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'simple', 'gpt-4o', 'openai', 'api_key');

      expect(existing.fallback_routes).toBeNull();
    });

    it('does not touch fallback_routes when override_route is null (ambiguous match)', async () => {
      // Ambiguous model name across two providers means the override has no
      // route. The fallback_routes list shouldn't be filtered against null.
      discoveryService.getModelsForAgent.mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'azure', authType: 'api_key' }),
      ]);
      const existing = makeTier({
        fallback_models: ['gpt-4o', 'claude-3-haiku'],
        fallback_routes: [
          { provider: 'azure', authType: 'api_key', model: 'gpt-4o' },
          { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
        ],
      });
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'simple', 'gpt-4o');

      expect(existing.fallback_routes).toEqual([
        { provider: 'azure', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('clears fallback_routes to null when removing the last entry', async () => {
      const existing = makeTier({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      });
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'simple', 'gpt-4o', 'openai', 'api_key');

      expect(existing.fallback_models).toBeNull();
      expect(existing.fallback_routes).toBeNull();
    });
  });

  describe('clearOverride', () => {
    it('clears legacy fields AND override_route in lockstep', async () => {
      const existing = makeTier({
        override_model: 'gpt-4o',
        override_provider: 'openai',
        override_auth_type: 'api_key',
        override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
      });
      tierRepo.findOne.mockResolvedValue(existing);

      await service.clearOverride('agent-1', 'simple');

      expect(existing.override_model).toBeNull();
      expect(existing.override_provider).toBeNull();
      expect(existing.override_auth_type).toBeNull();
      expect(existing.override_route).toBeNull();
    });
  });

  describe('resetAllOverrides', () => {
    it('clears all six override + route columns at once', async () => {
      await service.resetAllOverrides('agent-1');

      expect(tierRepo.update).toHaveBeenCalledWith(
        { agent_id: 'agent-1' },
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

  describe('setFallbacks — discovery resolution', () => {
    it('writes fallback_routes aligned 1:1 with fallback_models when every model resolves', async () => {
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setFallbacks('agent-1', 'simple', ['gpt-4o', 'claude-3-haiku']);

      expect(existing.fallback_models).toEqual(['gpt-4o', 'claude-3-haiku']);
      expect(existing.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('leaves fallback_routes null when ANY model is ambiguous', async () => {
      // gpt-4o is offered by both openai and azure. Even though claude-3-haiku
      // resolves cleanly, the partial state is dangerous: the proxy needs
      // either the full list with auths or none — it falls back to inference
      // when fallback_routes is null.
      discoveryService.getModelsForAgent.mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'azure', authType: 'api_key' }),
        makeDiscoveredModel({
          id: 'claude-3-haiku',
          provider: 'anthropic',
          authType: 'api_key',
        }),
      ]);
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setFallbacks('agent-1', 'simple', ['gpt-4o', 'claude-3-haiku']);

      expect(existing.fallback_models).toEqual(['gpt-4o', 'claude-3-haiku']);
      expect(existing.fallback_routes).toBeNull();
    });

    it('clears fallback_routes when the empty list is set', async () => {
      const existing = makeTier({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      });
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setFallbacks('agent-1', 'simple', []);

      expect(existing.fallback_models).toBeNull();
      expect(existing.fallback_routes).toBeNull();
    });
  });

  describe('setFallbacks — caller-supplied routes', () => {
    it('persists caller routes when they align 1:1 with the models', async () => {
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);
      const routes = [
        { provider: 'openai', authType: 'subscription' as const, model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key' as const, model: 'claude-3-haiku' },
      ];

      await service.setFallbacks('agent-1', 'simple', ['gpt-4o', 'claude-3-haiku'], routes);

      expect(existing.fallback_routes).toBe(routes);
      // Discovery must not be consulted on this branch — caller's intent wins.
      expect(discoveryService.getModelsForAgent).not.toHaveBeenCalled();
    });

    it('falls back to discovery when caller routes are misaligned with models', async () => {
      // Lengths match but the model order diverges — the helper detects this
      // and re-resolves via discovery to keep the columns coherent.
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);
      const wrongRoutes = [
        { provider: 'anthropic', authType: 'api_key' as const, model: 'claude-3-haiku' },
        { provider: 'openai', authType: 'api_key' as const, model: 'gpt-4o' },
      ];

      await service.setFallbacks('agent-1', 'simple', ['gpt-4o', 'claude-3-haiku'], wrongRoutes);

      expect(discoveryService.getModelsForAgent).toHaveBeenCalled();
      // Discovery's resolved order matches fallback_models
      expect(existing.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('falls back to discovery when caller-supplied routes are shorter than models', async () => {
      const existing = makeTier();
      tierRepo.findOne.mockResolvedValue(existing);

      await service.setFallbacks(
        'agent-1',
        'simple',
        ['gpt-4o', 'claude-3-haiku'],
        [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      );

      expect(discoveryService.getModelsForAgent).toHaveBeenCalled();
      expect(existing.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });
  });

  describe('clearFallbacks', () => {
    it('clears legacy fallback_models AND fallback_routes', async () => {
      const existing = makeTier({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      });
      tierRepo.findOne.mockResolvedValue(existing);

      await service.clearFallbacks('agent-1', 'simple');

      expect(existing.fallback_models).toBeNull();
      expect(existing.fallback_routes).toBeNull();
    });
  });
});
