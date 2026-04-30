import {
  effectiveRoute,
  readAutoAssignedRoute,
  readFallbackRoutes,
  readOverrideRoute,
} from '../route-helpers';
import { TierAssignment } from '../../../entities/tier-assignment.entity';

function makeRow(overrides: Partial<TierAssignment> = {}): TierAssignment {
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

describe('readOverrideRoute', () => {
  it('prefers the new shape when both legacy and route are present', () => {
    const row = makeRow({
      override_model: 'gpt-4o',
      override_provider: 'openai',
      override_auth_type: 'api_key',
      override_route: { provider: 'anthropic', authType: 'subscription', model: 'claude-opus' },
    });
    expect(readOverrideRoute(row)).toEqual({
      provider: 'anthropic',
      authType: 'subscription',
      model: 'claude-opus',
    });
  });

  it('falls back to the legacy triple when route is null', () => {
    const row = makeRow({
      override_model: 'gpt-4o',
      override_provider: 'openai',
      override_auth_type: 'api_key',
      override_route: null,
    });
    expect(readOverrideRoute(row)).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o',
    });
  });

  it('returns null when neither legacy nor route is set', () => {
    expect(readOverrideRoute(makeRow())).toBeNull();
  });

  it('falls through to legacy when override_route is malformed', () => {
    // Simulate a row where someone wrote a non-conforming JSON blob into the
    // jsonb column. The read should not crash; it should ignore the bogus
    // value and use the legacy triple.
    const row = makeRow({
      override_model: 'gpt-4o',
      override_provider: 'openai',
      override_auth_type: 'api_key',
      override_route: {
        provider: 'openai',
        model: 'gpt-4o',
      } as unknown as TierAssignment['override_route'],
    });
    expect(readOverrideRoute(row)).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o',
    });
  });

  it('falls through to legacy when override_route is the wrong type entirely', () => {
    const row = makeRow({
      override_model: 'gpt-4o',
      override_provider: 'openai',
      override_auth_type: 'api_key',
      override_route: 'gpt-4o' as unknown as TierAssignment['override_route'],
    });
    expect(readOverrideRoute(row)).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o',
    });
  });

  it('returns null when only the legacy model is set (no provider/auth)', () => {
    const row = makeRow({ override_model: 'gpt-4o' });
    expect(readOverrideRoute(row)).toBeNull();
  });
});

describe('readAutoAssignedRoute', () => {
  it('returns the route when present', () => {
    const row = makeRow({
      auto_assigned_model: 'gpt-4o',
      auto_assigned_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
    });
    expect(readAutoAssignedRoute(row)).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o',
    });
  });

  it('returns null when only the legacy auto_assigned_model is set', () => {
    // Legacy auto_assigned_model has no provider/auth, so the helper
    // intentionally returns null and lets the legacy resolver handle it.
    const row = makeRow({ auto_assigned_model: 'gpt-4o' });
    expect(readAutoAssignedRoute(row)).toBeNull();
  });

  it('returns null when nothing is set', () => {
    expect(readAutoAssignedRoute(makeRow())).toBeNull();
  });

  it('ignores a malformed auto_assigned_route', () => {
    const row = makeRow({
      auto_assigned_model: 'gpt-4o',
      auto_assigned_route: {
        provider: 'openai',
      } as unknown as TierAssignment['auto_assigned_route'],
    });
    expect(readAutoAssignedRoute(row)).toBeNull();
  });
});

describe('readFallbackRoutes', () => {
  it('returns the routes when fallback_routes is a valid ModelRoute[]', () => {
    const row = makeRow({
      fallback_routes: [
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
      ],
    });
    expect(readFallbackRoutes(row)).toHaveLength(2);
    expect(readFallbackRoutes(row)![0].model).toBe('gpt-4o');
  });

  it('returns null when fallback_routes is absent', () => {
    expect(readFallbackRoutes(makeRow())).toBeNull();
  });

  it('returns null when fallback_routes is not a valid ModelRoute[]', () => {
    const row = makeRow({
      // mixed valid/invalid: caller must fall through to legacy fallback_models
      fallback_routes: [
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'anthropic' } as unknown as {
          provider: string;
          authType: 'api_key';
          model: string;
        },
      ],
    });
    expect(readFallbackRoutes(row)).toBeNull();
  });

  it('returns null when fallback_routes is the wrong type', () => {
    const row = makeRow({
      fallback_routes: 'oops' as unknown as TierAssignment['fallback_routes'],
    });
    expect(readFallbackRoutes(row)).toBeNull();
  });

  it('returns an empty array as a valid (if empty) ModelRoute[]', () => {
    // An empty array is a valid ModelRoute[] structurally — readers should
    // get [] back rather than null, even if it's a degenerate case.
    const row = makeRow({ fallback_routes: [] });
    expect(readFallbackRoutes(row)).toEqual([]);
  });
});

describe('effectiveRoute', () => {
  it('prefers override over auto_assigned', () => {
    const row = makeRow({
      override_route: { provider: 'anthropic', authType: 'api_key', model: 'claude-opus' },
      auto_assigned_model: 'gpt-4o',
      auto_assigned_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
    });
    expect(effectiveRoute(row)).toEqual({
      provider: 'anthropic',
      authType: 'api_key',
      model: 'claude-opus',
    });
  });

  it('falls back to legacy override when override_route is null', () => {
    const row = makeRow({
      override_model: 'gpt-4o',
      override_provider: 'openai',
      override_auth_type: 'api_key',
      auto_assigned_route: { provider: 'anthropic', authType: 'api_key', model: 'claude-3-haiku' },
    });
    expect(effectiveRoute(row)).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o',
    });
  });

  it('returns auto_assigned_route when override is missing', () => {
    const row = makeRow({
      auto_assigned_model: 'gpt-4o',
      auto_assigned_route: { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
    });
    expect(effectiveRoute(row)).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-4o',
    });
  });

  it('returns null when neither override nor auto_assigned_route is set', () => {
    expect(effectiveRoute(makeRow())).toBeNull();
  });

  it('returns null when only the legacy auto_assigned_model is set (no route)', () => {
    // Per readAutoAssignedRoute contract: a bare auto_assigned_model with no
    // provider/auth doesn't resolve to a route. The caller falls back to the
    // legacy resolver.
    const row = makeRow({ auto_assigned_model: 'gpt-4o' });
    expect(effectiveRoute(row)).toBeNull();
  });
});
