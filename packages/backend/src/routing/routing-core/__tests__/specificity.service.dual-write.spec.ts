import { SpecificityService } from '../specificity.service';
import { RoutingCacheService } from '../routing-cache.service';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { DiscoveredModel } from '../../../model-discovery/model-fetcher';
import { SpecificityAssignment } from '../../../entities/specificity-assignment.entity';

/**
 * Mirrors tier.service.dual-write.spec.ts for specificity. The two services
 * share the same dual-write helpers (explicitRoute / unambiguousRoute /
 * buildFallbackRoutes), so the assertions look similar — but each entry
 * point needs its own coverage so a regression in one doesn't slip past the
 * other.
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

function makeMockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: unknown) => Promise.resolve(entity)),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAssignment(overrides: Partial<SpecificityAssignment> = {}): SpecificityAssignment {
  return Object.assign(new SpecificityAssignment(), {
    id: 'sa-1',
    user_id: 'user-1',
    agent_id: 'agent-1',
    category: 'coding',
    is_active: true,
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

describe('SpecificityService — dual-write invariants', () => {
  let service: SpecificityService;
  let repo: ReturnType<typeof makeMockRepo>;
  let cache: {
    getSpecificity: jest.Mock;
    setSpecificity: jest.Mock;
    invalidateAgent: jest.Mock;
  };
  let discoveryService: { getModelsForAgent: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    repo = makeMockRepo();
    cache = {
      getSpecificity: jest.fn().mockReturnValue(null),
      setSpecificity: jest.fn(),
      invalidateAgent: jest.fn(),
    };
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

    service = new SpecificityService(
      repo as unknown as any,
      cache as unknown as RoutingCacheService,
      discoveryService as unknown as ModelDiscoveryService,
    );
  });

  describe('setOverride — explicit triple', () => {
    it('writes legacy fields AND override_route together for an existing assignment', async () => {
      const existing = makeAssignment();
      repo.findOne.mockResolvedValue(existing);

      const result = await service.setOverride(
        'agent-1',
        'user-1',
        'coding',
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
      repo.findOne.mockResolvedValue(null);

      const result = await service.setOverride(
        'agent-1',
        'user-1',
        'coding',
        'gpt-4o',
        'openai',
        'api_key',
      );

      expect(repo.insert).toHaveBeenCalledTimes(1);
      expect(result.override_model).toBe('gpt-4o');
      expect(result.override_route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
    });
  });

  describe('setOverride — discovery-resolved route', () => {
    it('populates both shapes when the model resolves unambiguously', async () => {
      const existing = makeAssignment();
      repo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'coding', 'gpt-4o');

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
      discoveryService.getModelsForAgent.mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'azure', authType: 'api_key' }),
      ]);
      const existing = makeAssignment();
      repo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'coding', 'gpt-4o');

      expect(existing.override_model).toBe('gpt-4o');
      expect(existing.override_route).toBeNull();
    });

    it('marks the assignment active on setOverride', async () => {
      const existing = makeAssignment({ is_active: false });
      repo.findOne.mockResolvedValue(existing);

      await service.setOverride('agent-1', 'user-1', 'coding', 'gpt-4o', 'openai', 'api_key');

      expect(existing.is_active).toBe(true);
    });
  });

  describe('clearOverride', () => {
    it('clears legacy fields AND override_route AND fallback_routes', async () => {
      const existing = makeAssignment({
        override_model: 'gpt-4o',
        override_provider: 'openai',
        override_auth_type: 'api_key',
        fallback_models: ['claude-3-haiku'],
        override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        fallback_routes: [{ provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' }],
      });
      repo.findOne.mockResolvedValue(existing);

      await service.clearOverride('agent-1', 'coding');

      expect(existing.override_model).toBeNull();
      expect(existing.override_provider).toBeNull();
      expect(existing.override_auth_type).toBeNull();
      expect(existing.fallback_models).toBeNull();
      expect(existing.override_route).toBeNull();
      expect(existing.fallback_routes).toBeNull();
    });
  });

  describe('resetAll', () => {
    it('clears every override + route column for the agent', async () => {
      await service.resetAll('agent-1');

      expect(repo.update).toHaveBeenCalledWith(
        { agent_id: 'agent-1' },
        expect.objectContaining({
          is_active: false,
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
    it('writes fallback_routes aligned 1:1 with fallback_models when discovery resolves all', async () => {
      const existing = makeAssignment();
      repo.findOne.mockResolvedValue(existing);

      await service.setFallbacks('agent-1', 'coding', ['gpt-4o', 'claude-3-haiku']);

      expect(existing.fallback_models).toEqual(['gpt-4o', 'claude-3-haiku']);
      expect(existing.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('leaves fallback_routes null when ANY model is ambiguous', async () => {
      discoveryService.getModelsForAgent.mockResolvedValue([
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'openai', authType: 'api_key' }),
        makeDiscoveredModel({ id: 'gpt-4o', provider: 'azure', authType: 'api_key' }),
        makeDiscoveredModel({
          id: 'claude-3-haiku',
          provider: 'anthropic',
          authType: 'api_key',
        }),
      ]);
      const existing = makeAssignment();
      repo.findOne.mockResolvedValue(existing);

      await service.setFallbacks('agent-1', 'coding', ['gpt-4o', 'claude-3-haiku']);

      expect(existing.fallback_models).toEqual(['gpt-4o', 'claude-3-haiku']);
      expect(existing.fallback_routes).toBeNull();
    });

    it('persists caller-supplied routes verbatim when aligned with the models', async () => {
      const existing = makeAssignment();
      repo.findOne.mockResolvedValue(existing);
      const routes = [
        { provider: 'openai', authType: 'subscription' as const, model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key' as const, model: 'claude-3-haiku' },
      ];

      await service.setFallbacks('agent-1', 'coding', ['gpt-4o', 'claude-3-haiku'], routes);

      expect(existing.fallback_routes).toBe(routes);
      expect(discoveryService.getModelsForAgent).not.toHaveBeenCalled();
    });

    it('falls back to discovery when caller routes are misaligned', async () => {
      const existing = makeAssignment();
      repo.findOne.mockResolvedValue(existing);

      await service.setFallbacks(
        'agent-1',
        'coding',
        ['gpt-4o', 'claude-3-haiku'],
        [
          { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
          { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        ],
      );

      expect(discoveryService.getModelsForAgent).toHaveBeenCalled();
      expect(existing.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('returns [] without writing when the assignment does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      const out = await service.setFallbacks('agent-1', 'coding', ['gpt-4o']);

      expect(out).toEqual([]);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('clearFallbacks', () => {
    it('clears legacy fallback_models AND fallback_routes', async () => {
      const existing = makeAssignment({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      });
      repo.findOne.mockResolvedValue(existing);

      await service.clearFallbacks('agent-1', 'coding');

      expect(existing.fallback_models).toBeNull();
      expect(existing.fallback_routes).toBeNull();
    });

    it('is a no-op when the assignment does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.clearFallbacks('agent-1', 'coding');

      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
