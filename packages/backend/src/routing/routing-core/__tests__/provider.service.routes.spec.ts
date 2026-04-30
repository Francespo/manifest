import { ProviderService } from '../provider.service';
import { TierAutoAssignService } from '../tier-auto-assign.service';
import { RoutingCacheService } from '../routing-cache.service';
import { ModelPricingCacheService } from '../../../model-prices/model-pricing-cache.service';
import { UserProvider } from '../../../entities/user-provider.entity';
import { TierAssignment } from '../../../entities/tier-assignment.entity';
import { SpecificityAssignment } from '../../../entities/specificity-assignment.entity';

/**
 * When a provider is removed, ProviderService.cleanupProviderReferences
 * (private, exercised via removeProvider()) must clear BOTH legacy override
 * columns AND route columns, on both tier and specificity assignments — so
 * a deleted provider can never leave an orphan override_route behind.
 *
 * deactivateAllProviders has its own assertion path that has to clear the
 * route columns too.
 */

jest.mock('../../../common/utils/crypto.util', () => ({
  encrypt: jest.fn().mockReturnValue('encrypted-value'),
  getEncryptionSecret: jest.fn().mockReturnValue('secret'),
}));

jest.mock('../../../common/utils/subscription-support', () => ({
  isSupportedSubscriptionProvider: jest.fn().mockReturnValue(false),
  isManifestUsableProvider: jest.fn(() => true),
}));

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  remove: jest.Mock;
  manager: { transaction: jest.Mock };
};

function makeMockRepo(): MockRepo {
  const find = jest.fn().mockResolvedValue([]);
  const findOne = jest.fn().mockResolvedValue(null);
  const save = jest.fn().mockImplementation((entity: unknown) => Promise.resolve(entity));
  const insert = jest.fn().mockResolvedValue(undefined);
  const update = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(undefined);
  const repoFacade = { find, findOne, save, insert, update, remove };
  const manager = {
    transaction: jest.fn(async (cb: (m: { getRepository: () => unknown }) => Promise<unknown>) =>
      cb({ getRepository: () => repoFacade }),
    ),
  };
  return { find, findOne, save, insert, update, remove, manager };
}

function makeProvider(overrides: Partial<UserProvider> = {}): UserProvider {
  return Object.assign(new UserProvider(), {
    id: 'prov-1',
    user_id: 'user-1',
    agent_id: 'agent-1',
    provider: 'openai',
    auth_type: 'api_key' as const,
    api_key_encrypted: 'enc',
    key_prefix: 'sk-',
    is_active: true,
    connected_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    cached_models: null,
    models_fetched_at: null,
    ...overrides,
  });
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

function makeSpec(overrides: Partial<SpecificityAssignment> = {}): SpecificityAssignment {
  return Object.assign(new SpecificityAssignment(), {
    id: 'spec-1',
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

describe('ProviderService — route cleanup on provider removal', () => {
  let service: ProviderService;
  let providerRepo: ReturnType<typeof makeMockRepo>;
  let tierRepo: ReturnType<typeof makeMockRepo>;
  let specificityRepo: ReturnType<typeof makeMockRepo>;
  let autoAssign: { recalculate: jest.Mock };
  let routingCache: {
    invalidateAgent: jest.Mock;
    getProviders: jest.Mock;
    setProviders: jest.Mock;
  };
  let pricingCache: { getByModel: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    providerRepo = makeMockRepo();
    tierRepo = makeMockRepo();
    specificityRepo = makeMockRepo();
    autoAssign = { recalculate: jest.fn().mockResolvedValue(undefined) };
    routingCache = {
      invalidateAgent: jest.fn(),
      getProviders: jest.fn().mockReturnValue(null),
      setProviders: jest.fn(),
    };
    pricingCache = { getByModel: jest.fn().mockReturnValue(undefined) };

    service = new ProviderService(
      providerRepo as unknown as any,
      tierRepo as unknown as any,
      specificityRepo as unknown as any,
      autoAssign as unknown as TierAutoAssignService,
      pricingCache as unknown as ModelPricingCacheService,
      routingCache as unknown as RoutingCacheService,
    );
  });

  describe('removeProvider — tier cleanup', () => {
    it('clears override_route alongside legacy override columns when the override matches the removed provider', async () => {
      const removed = makeProvider({ provider: 'openai' });
      providerRepo.findOne.mockResolvedValue(removed);
      providerRepo.find.mockResolvedValue([]); // no other active provider

      const tier = makeTier({
        override_model: 'gpt-4o',
        override_provider: 'openai',
        override_auth_type: 'api_key',
        override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
      });
      tierRepo.find
        .mockResolvedValueOnce([tier]) // overrides query
        .mockResolvedValueOnce([tier]) // allTiers query
        .mockResolvedValueOnce([tier]); // notification re-read

      await service.removeProvider('agent-1', 'openai');

      expect(tier.override_model).toBeNull();
      expect(tier.override_provider).toBeNull();
      expect(tier.override_auth_type).toBeNull();
      expect(tier.override_route).toBeNull();
    });

    it('clears a stale override_route even when the legacy override columns were already null', async () => {
      // Defensive: the row's legacy columns are empty but override_route was
      // populated by a later write. Cleanup must still drop the route.
      const removed = makeProvider({ provider: 'openai' });
      providerRepo.findOne.mockResolvedValue(removed);
      providerRepo.find.mockResolvedValue([]);

      const tier = makeTier({
        override_model: null,
        override_provider: null,
        override_auth_type: null,
        override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
      });
      tierRepo.find
        .mockResolvedValueOnce([]) // no override_model match (Not(IsNull))
        .mockResolvedValueOnce([tier]); // allTiers — second pass picks up route

      await service.removeProvider('agent-1', 'openai');

      expect(tier.override_route).toBeNull();
    });

    it('drops fallback_routes entries belonging to the removed provider', async () => {
      const removed = makeProvider({ provider: 'openai' });
      providerRepo.findOne.mockResolvedValue(removed);
      providerRepo.find.mockResolvedValue([]);

      const tier = makeTier({
        fallback_models: ['gpt-4o', 'claude-3-haiku'],
        fallback_routes: [
          { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
          { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
        ],
      });
      tierRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([tier]);

      await service.removeProvider('agent-1', 'openai');

      expect(tier.fallback_routes).toEqual([
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('sets fallback_routes to null when every entry belonged to the removed provider', async () => {
      const removed = makeProvider({ provider: 'openai' });
      providerRepo.findOne.mockResolvedValue(removed);
      providerRepo.find.mockResolvedValue([]);

      const tier = makeTier({
        fallback_models: ['gpt-4o'],
        fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
      });
      tierRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([tier]);

      await service.removeProvider('agent-1', 'openai');

      expect(tier.fallback_routes).toBeNull();
    });
  });

  describe('removeProvider — specificity cleanup', () => {
    it('clears specificity override_route alongside legacy override columns', async () => {
      const removed = makeProvider({ provider: 'openai' });
      providerRepo.findOne.mockResolvedValue(removed);
      providerRepo.find.mockResolvedValue([]);
      tierRepo.find.mockResolvedValue([]);

      const spec = makeSpec({
        override_model: 'gpt-4o',
        override_provider: 'openai',
        override_auth_type: 'api_key',
        override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
      });
      specificityRepo.find.mockResolvedValue([spec]);

      await service.removeProvider('agent-1', 'openai');

      expect(spec.override_model).toBeNull();
      expect(spec.override_provider).toBeNull();
      expect(spec.override_auth_type).toBeNull();
      expect(spec.override_route).toBeNull();
    });

    it('drops specificity fallback_routes entries belonging to the removed provider', async () => {
      const removed = makeProvider({ provider: 'openai' });
      providerRepo.findOne.mockResolvedValue(removed);
      providerRepo.find.mockResolvedValue([]);
      tierRepo.find.mockResolvedValue([]);

      const spec = makeSpec({
        fallback_models: ['gpt-4o', 'claude-3-haiku'],
        fallback_routes: [
          { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
          { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
        ],
      });
      specificityRepo.find.mockResolvedValue([spec]);

      await service.removeProvider('agent-1', 'openai');

      expect(spec.fallback_routes).toEqual([
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('clears a stale override_route on a specificity row whose legacy column was null', async () => {
      const removed = makeProvider({ provider: 'openai' });
      providerRepo.findOne.mockResolvedValue(removed);
      providerRepo.find.mockResolvedValue([]);
      tierRepo.find.mockResolvedValue([]);

      const spec = makeSpec({
        override_model: null,
        override_provider: null,
        override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
      });
      specificityRepo.find.mockResolvedValue([spec]);

      await service.removeProvider('agent-1', 'openai');

      expect(spec.override_route).toBeNull();
    });
  });

  describe('deactivateAllProviders', () => {
    it('clears every legacy AND route column on every tier in a single update', async () => {
      await service.deactivateAllProviders('agent-1');

      expect(tierRepo.update).toHaveBeenCalledWith(
        { agent_id: 'agent-1' },
        expect.objectContaining({
          override_model: null,
          override_provider: null,
          override_auth_type: null,
          fallback_models: null,
          override_route: null,
          auto_assigned_route: null,
          fallback_routes: null,
        }),
      );
    });
  });
});
