import { RoutingInvalidationService } from '../routing-invalidation.service';
import { TierAutoAssignService } from '../tier-auto-assign.service';
import { RoutingCacheService } from '../routing-cache.service';
import { ModelPricingCacheService } from '../../../model-prices/model-pricing-cache.service';
import { TierAssignment } from '../../../entities/tier-assignment.entity';

/**
 * Locks the cleanup invariants: when a model is removed (e.g. after pricing
 * sync drops it), BOTH the legacy override columns AND the route columns get
 * cleared in the same write. No orphaned override_route may persist
 * referencing a deleted model.
 */

function makeMockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockImplementation((entity: unknown) => Promise.resolve(entity)),
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

describe('RoutingInvalidationService — route column cleanup', () => {
  let service: RoutingInvalidationService;
  let tierRepo: ReturnType<typeof makeMockRepo>;
  let pricingCache: { getByModel: jest.Mock };
  let autoAssign: { recalculate: jest.Mock };
  let routingCache: { invalidateAgent: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    tierRepo = makeMockRepo();
    pricingCache = { getByModel: jest.fn().mockReturnValue(undefined) };
    autoAssign = { recalculate: jest.fn().mockResolvedValue(undefined) };
    routingCache = { invalidateAgent: jest.fn() };

    service = new RoutingInvalidationService(
      tierRepo as unknown as any,
      pricingCache as unknown as ModelPricingCacheService,
      autoAssign as unknown as TierAutoAssignService,
      routingCache as unknown as RoutingCacheService,
    );
  });

  it('clears override_route alongside legacy override columns when the model is removed', async () => {
    const tier = makeTier({
      override_model: 'gpt-4o',
      override_provider: 'openai',
      override_auth_type: 'api_key',
      override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
    });
    tierRepo.find.mockResolvedValueOnce([tier]).mockResolvedValueOnce([tier]);

    await service.invalidateOverridesForRemovedModels(['gpt-4o']);

    expect(tier.override_model).toBeNull();
    expect(tier.override_provider).toBeNull();
    expect(tier.override_auth_type).toBeNull();
    expect(tier.override_route).toBeNull();
  });

  it('drops fallback_routes entries that reference removed models, preserving the rest', async () => {
    tierRepo.find.mockResolvedValueOnce([]); // no overrides
    const tierWithFallbacks = makeTier({
      agent_id: 'agent-2',
      fallback_models: ['gpt-4o', 'claude-3-haiku'],
      fallback_routes: [
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ],
    });
    tierRepo.find.mockResolvedValueOnce([tierWithFallbacks]);

    await service.invalidateOverridesForRemovedModels(['gpt-4o']);

    expect(tierWithFallbacks.fallback_models).toEqual(['claude-3-haiku']);
    expect(tierWithFallbacks.fallback_routes).toEqual([
      { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
    ]);
  });

  it('sets fallback_routes to null when every entry was removed', async () => {
    tierRepo.find.mockResolvedValueOnce([]);
    const tier = makeTier({
      agent_id: 'agent-1',
      fallback_models: ['gpt-4o'],
      fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
    });
    tierRepo.find.mockResolvedValueOnce([tier]);

    await service.invalidateOverridesForRemovedModels(['gpt-4o']);

    expect(tier.fallback_models).toBeNull();
    expect(tier.fallback_routes).toBeNull();
  });

  it('clears a stale override_route alongside fallback cleanup on the same row', async () => {
    // Edge case: a row with both fallback content AND a stale override_route
    // pointing at the removed model. The fallback-cleanup loop runs (because
    // there are fallbacks) and picks up the orphan override_route too.
    tierRepo.find.mockResolvedValueOnce([]); // no legacy override_model match
    const tier = makeTier({
      agent_id: 'agent-1',
      override_model: null,
      override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
      fallback_models: ['claude-3-haiku'],
      fallback_routes: [{ provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' }],
    });
    tierRepo.find.mockResolvedValueOnce([tier]);

    await service.invalidateOverridesForRemovedModels(['gpt-4o']);

    expect(tier.override_route).toBeNull();
    // Fallback content unrelated to the removed model is preserved.
    expect(tier.fallback_models).toEqual(['claude-3-haiku']);
    expect(tierRepo.save).toHaveBeenCalled();
  });

  it('does not save rows whose route columns are unrelated to the removed models', async () => {
    tierRepo.find.mockResolvedValueOnce([]);
    const tier = makeTier({
      agent_id: 'agent-1',
      fallback_models: ['claude-3-haiku'],
      fallback_routes: [{ provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' }],
      override_route: null,
    });
    tierRepo.find.mockResolvedValueOnce([tier]);

    await service.invalidateOverridesForRemovedModels(['gpt-4o']);

    expect(tier.fallback_models).toEqual(['claude-3-haiku']);
    expect(tier.fallback_routes).toEqual([
      { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
    ]);
    expect(tierRepo.save).not.toHaveBeenCalled();
  });
});
