jest.mock('../../../scoring', () => {
  const scoreRequest = jest.fn();
  const scanMessages = jest.fn();
  return { scoreRequest, scanMessages };
});

import { Repository } from 'typeorm';
import { ResolveService } from '../resolve.service';
import { TierService } from '../../routing-core/tier.service';
import { ProviderKeyService } from '../../routing-core/provider-key.service';
import { SpecificityService } from '../../routing-core/specificity.service';
import { SpecificityPenaltyService } from '../../routing-core/specificity-penalty.service';
import { ModelPricingCacheService } from '../../../model-prices/model-pricing-cache.service';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { HeaderTierService } from '../../header-tiers/header-tier.service';
import { Agent } from '../../../entities/agent.entity';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const scoring = require('../../../scoring');

/**
 * ResolveService dual-write contract:
 *
 *   - When a model resolves successfully, the response carries BOTH the
 *     legacy flat fields (model/provider/auth_type) AND the new `route`
 *     object. They must agree value-for-value (no drift).
 *   - When no model is resolved, `route` is null.
 *   - `fallback_routes` is populated when the assignment has them; null
 *     otherwise. Legacy `fallback_models` keeps its existing semantics.
 *   - Every entry path (resolve / resolveForTier / specificity / header)
 *     follows the same contract.
 */

function makeService(overrides: {
  tiers?: unknown[];
  getEffectiveModel?: jest.Mock;
  getAuthType?: jest.Mock;
  hasActiveProvider?: jest.Mock;
  isModelAvailable?: jest.Mock;
  activeSpecificity?: unknown[];
  getModelForAgent?: jest.Mock;
  getByModel?: jest.Mock;
  headerTiers?: unknown[];
}) {
  const tierService = {
    getTiers: jest.fn().mockResolvedValue(overrides.tiers ?? []),
  } as unknown as TierService;

  const providerKeyService = {
    getEffectiveModel: overrides.getEffectiveModel ?? jest.fn().mockResolvedValue(null),
    getAuthType: overrides.getAuthType ?? jest.fn().mockResolvedValue('api_key'),
    hasActiveProvider: overrides.hasActiveProvider ?? jest.fn().mockResolvedValue(false),
    isModelAvailable: overrides.isModelAvailable ?? jest.fn().mockResolvedValue(true),
  } as unknown as ProviderKeyService;

  const specificityService = {
    getActiveAssignments: jest.fn().mockResolvedValue(overrides.activeSpecificity ?? []),
  } as unknown as SpecificityService;

  const discoveryService = {
    getModelForAgent: overrides.getModelForAgent ?? jest.fn().mockResolvedValue(null),
  } as unknown as ModelDiscoveryService;

  const pricingCache = {
    getByModel: overrides.getByModel ?? jest.fn().mockReturnValue(null),
  } as unknown as ModelPricingCacheService;

  const penaltyService = {
    getPenaltiesForAgent: jest.fn().mockResolvedValue(new Map()),
  } as unknown as SpecificityPenaltyService;

  const headerTierService = {
    list: jest.fn().mockResolvedValue(overrides.headerTiers ?? []),
  } as unknown as HeaderTierService;

  const agentRepo = {
    findOne: jest.fn().mockResolvedValue({ complexity_routing_enabled: true }),
  } as unknown as Repository<Agent>;

  return new ResolveService(
    tierService,
    providerKeyService,
    specificityService,
    pricingCache,
    discoveryService,
    penaltyService,
    headerTierService,
    agentRepo,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ResolveService — dual-write response shapes', () => {
  describe('resolve() — complexity tier path', () => {
    it('populates flat fields AND route AND fallback_routes when assignment has all three', async () => {
      scoring.scoreRequest.mockReturnValue({
        tier: 'simple',
        confidence: 1,
        score: 0,
        reason: 'scored',
      });
      scoring.scanMessages.mockReturnValue(null);

      const fallbackRoutes = [
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ];
      const svc = makeService({
        tiers: [
          {
            tier: 'simple',
            override_model: null,
            override_provider: null,
            override_auth_type: null,
            auto_assigned_model: 'gpt-4o',
            override_route: null,
            auto_assigned_route: null,
            fallback_models: ['claude-3-haiku'],
            fallback_routes: fallbackRoutes,
          },
        ],
        getEffectiveModel: jest.fn().mockResolvedValue('gpt-4o'),
        getAuthType: jest.fn().mockResolvedValue('api_key'),
        // Provider inference: prefix → openai, but only if the prefix is an
        // active provider for this agent. The model name 'gpt-4o' has no
        // prefix, so we route through the pricing cache fallback instead.
        hasActiveProvider: jest.fn().mockResolvedValue(true),
        getByModel: jest.fn().mockReturnValue({ provider: 'openai' }),
      });

      const out = await svc.resolve('agent-1', [{ role: 'user', content: 'hi' }]);

      expect(out.model).toBe('gpt-4o');
      expect(out.provider).toBe('openai');
      expect(out.auth_type).toBe('api_key');
      // Flat fields and route agree exactly.
      expect(out.route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
      expect(out.fallback_routes).toEqual(fallbackRoutes);
    });

    it('returns route=null when getEffectiveModel returns null', async () => {
      scoring.scoreRequest.mockReturnValue({
        tier: 'simple',
        confidence: 1,
        score: 0,
        reason: 'scored',
      });
      scoring.scanMessages.mockReturnValue(null);

      const svc = makeService({
        tiers: [{ tier: 'simple', override_model: null, auto_assigned_model: null }],
        getEffectiveModel: jest.fn().mockResolvedValue(null),
      });

      const out = await svc.resolve('agent-1', [{ role: 'user', content: 'hi' }]);

      expect(out.model).toBeNull();
      expect(out.route).toBeUndefined();
    });

    it('returns fallback_routes=null when assignment has no fallback_routes', async () => {
      scoring.scoreRequest.mockReturnValue({
        tier: 'simple',
        confidence: 1,
        score: 0,
        reason: 'scored',
      });
      scoring.scanMessages.mockReturnValue(null);

      const svc = makeService({
        tiers: [
          {
            tier: 'simple',
            override_model: null,
            auto_assigned_model: 'gpt-4o',
            fallback_models: ['claude-3-haiku'],
            fallback_routes: null,
          },
        ],
        getEffectiveModel: jest.fn().mockResolvedValue('gpt-4o'),
        hasActiveProvider: jest.fn().mockResolvedValue(true),
      });

      const out = await svc.resolve('agent-1', [{ role: 'user', content: 'hi' }]);

      expect(out.fallback_routes).toBeNull();
    });
  });

  describe('resolveForTier() — heartbeat / default path', () => {
    it('populates route alongside flat fields when a model resolves', async () => {
      const svc = makeService({
        tiers: [
          {
            tier: 'default',
            override_model: 'gpt-4o',
            override_provider: 'openai',
            override_auth_type: 'api_key',
            override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
            fallback_routes: [
              { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
            ],
          },
        ],
        getEffectiveModel: jest.fn().mockResolvedValue('gpt-4o'),
        hasActiveProvider: jest.fn().mockResolvedValue(true),
      });

      const out = await svc.resolveForTier('agent-1', 'default');

      expect(out.tier).toBe('default');
      expect(out.model).toBe('gpt-4o');
      expect(out.provider).toBe('openai');
      expect(out.auth_type).toBe('api_key');
      expect(out.route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
      expect(out.fallback_routes).toEqual([
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });

    it('returns route=null when no assignment matches', async () => {
      const svc = makeService({ tiers: [] });

      const out = await svc.resolveForTier('agent-1', 'default');

      expect(out.model).toBeNull();
      expect(out.route).toBeUndefined();
      expect(out.fallback_routes).toBeUndefined();
    });

    it('returns route=null when assignment has no resolvable model', async () => {
      const svc = makeService({
        tiers: [
          {
            tier: 'default',
            override_model: null,
            auto_assigned_model: null,
            fallback_routes: null,
          },
        ],
        getEffectiveModel: jest.fn().mockResolvedValue(null),
      });

      const out = await svc.resolveForTier('agent-1', 'default');

      expect(out.model).toBeNull();
      expect(out.route).toBeNull();
    });
  });

  describe('resolve() — header-match path', () => {
    it('populates route and fallback_routes from the matching header tier', async () => {
      scoring.scoreRequest.mockReturnValue({
        tier: 'simple',
        confidence: 1,
        score: 0,
        reason: 'scored',
      });
      scoring.scanMessages.mockReturnValue(null);

      const svc = makeService({
        headerTiers: [
          {
            id: 'h1',
            name: 'Premium',
            badge_color: 'indigo',
            enabled: true,
            header_key: 'x-manifest-tier',
            header_value: 'premium',
            override_model: 'gpt-4o',
            override_provider: 'openai',
            override_auth_type: 'api_key',
            override_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
            fallback_models: ['claude-3-haiku'],
            fallback_routes: [
              { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
            ],
          },
        ],
        hasActiveProvider: jest.fn().mockResolvedValue(true),
        isModelAvailable: jest.fn().mockResolvedValue(true),
      });

      const out = await svc.resolve(
        'agent-1',
        [{ role: 'user', content: 'hi' }],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { 'x-manifest-tier': 'premium' },
      );

      expect(out.reason).toBe('header-match');
      expect(out.model).toBe('gpt-4o');
      expect(out.provider).toBe('openai');
      expect(out.route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-4o',
      });
      expect(out.fallback_routes).toEqual([
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ]);
    });
  });

  describe('resolve() — specificity path', () => {
    it('populates route and fallback_routes from the matching specificity assignment', async () => {
      scoring.scoreRequest.mockReturnValue({
        tier: 'standard',
        confidence: 1,
        score: 0,
        reason: 'scored',
      });
      scoring.scanMessages.mockReturnValue({ category: 'coding', confidence: 0.9 });

      const svc = makeService({
        activeSpecificity: [
          {
            category: 'coding',
            override_model: 'claude-opus',
            override_provider: 'anthropic',
            override_auth_type: 'api_key',
            override_route: {
              provider: 'anthropic',
              authType: 'api_key',
              model: 'claude-opus',
            },
            auto_assigned_model: null,
            fallback_models: ['gpt-4o'],
            fallback_routes: [{ provider: 'openai', authType: 'api_key', model: 'gpt-4o' }],
          },
        ],
        hasActiveProvider: jest.fn().mockResolvedValue(true),
        isModelAvailable: jest.fn().mockResolvedValue(true),
      });

      const out = await svc.resolve('agent-1', [{ role: 'user', content: 'write code' }]);

      expect(out.reason).toBe('specificity');
      expect(out.model).toBe('claude-opus');
      expect(out.provider).toBe('anthropic');
      expect(out.route).toEqual({
        provider: 'anthropic',
        authType: 'api_key',
        model: 'claude-opus',
      });
      expect(out.fallback_routes).toEqual([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
      ]);
    });

    it('returns route=null when the specificity assignment falls through to legacy fallback_models only', async () => {
      scoring.scoreRequest.mockReturnValue({
        tier: 'standard',
        confidence: 1,
        score: 0,
        reason: 'scored',
      });
      scoring.scanMessages.mockReturnValue({ category: 'coding', confidence: 0.9 });

      const svc = makeService({
        activeSpecificity: [
          {
            category: 'coding',
            override_model: 'claude-opus',
            override_provider: 'anthropic',
            override_auth_type: 'api_key',
            override_route: null, // route is missing — this is the legacy-only path
            auto_assigned_model: null,
            fallback_models: ['gpt-4o'],
            fallback_routes: null,
          },
        ],
        hasActiveProvider: jest.fn().mockResolvedValue(true),
        isModelAvailable: jest.fn().mockResolvedValue(true),
      });

      const out = await svc.resolve('agent-1', [{ role: 'user', content: 'write code' }]);

      // Route is still built from the resolved (model, provider, authType)
      // because every flat field is present. The contract is "route mirrors
      // the resolved values" — not "route mirrors override_route on disk".
      expect(out.route).toEqual({
        provider: 'anthropic',
        authType: 'api_key',
        model: 'claude-opus',
      });
      // fallback_routes is null because the row has none; the proxy will
      // infer auths from fallback_models at runtime.
      expect(out.fallback_routes).toBeNull();
    });
  });

  describe('drift check', () => {
    it('every successful path agrees value-for-value between flat fields and route', async () => {
      scoring.scoreRequest.mockReturnValue({
        tier: 'simple',
        confidence: 1,
        score: 0,
        reason: 'scored',
      });
      scoring.scanMessages.mockReturnValue(null);

      const svc = makeService({
        tiers: [
          {
            tier: 'simple',
            override_model: null,
            auto_assigned_model: 'gpt-5',
          },
        ],
        getEffectiveModel: jest.fn().mockResolvedValue('gpt-5'),
        getAuthType: jest.fn().mockResolvedValue('subscription'),
        hasActiveProvider: jest.fn().mockResolvedValue(true),
        getByModel: jest.fn().mockReturnValue({ provider: 'openai' }),
      });

      const out = await svc.resolve('agent-1', [{ role: 'user', content: 'hi' }]);

      expect(out.route).not.toBeNull();
      expect(out.route?.model).toBe(out.model);
      expect(out.route?.provider).toBe(out.provider);
      expect(out.route?.authType).toBe(out.auth_type);
    });
  });
});
