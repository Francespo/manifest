import { Repository } from 'typeorm';
import { TierAutoAssignService } from '../tier-auto-assign.service';
import { TierAssignment } from '../../../entities/tier-assignment.entity';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { DiscoveredModel } from '../../../model-discovery/model-fetcher';

/**
 * Extra coverage for the dual-write invariant in TierAutoAssignService:
 *   recalculate() must populate auto_assigned_route alongside
 *   auto_assigned_model on every tier slot, using the (provider, authType)
 *   carried by the picked DiscoveredModel.
 *
 * The existing tier-auto-assign.service.spec.ts (in the parent dir) covers
 * picking logic. This file isolates the route-shape contract.
 */

function m(partial: Partial<DiscoveredModel> & { id: string; provider: string }): DiscoveredModel {
  return {
    name: partial.id,
    authType: 'api_key',
    inputPricePerToken: null,
    outputPricePerToken: null,
    qualityScore: 3,
    capabilityCode: false,
    capabilityReasoning: false,
    ...partial,
  } as DiscoveredModel;
}

function makeService(options: {
  models?: DiscoveredModel[];
  existingTiers?: Partial<TierAssignment>[];
}) {
  const getModelsForAgent = jest.fn().mockResolvedValue(options.models ?? []);
  const find = jest.fn().mockResolvedValue(options.existingTiers ?? []);
  const save = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockResolvedValue(undefined);

  const discoveryService = { getModelsForAgent } as unknown as ModelDiscoveryService;
  const tierRepo = { find, save, insert } as unknown as Repository<TierAssignment>;
  const svc = new TierAutoAssignService(discoveryService, tierRepo);
  return { svc, getModelsForAgent, find, save, insert };
}

describe('TierAutoAssignService — auto_assigned_route dual-write', () => {
  it('writes auto_assigned_route alongside auto_assigned_model on every inserted slot', async () => {
    const { svc, insert } = makeService({
      models: [
        m({
          id: 'gpt-5',
          provider: 'openai',
          authType: 'api_key',
          inputPricePerToken: 5,
          outputPricePerToken: 5,
          qualityScore: 7,
          capabilityCode: true,
        }),
      ],
    });

    await svc.recalculate('agent-1');

    const inserted = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    for (const row of inserted) {
      expect(row.auto_assigned_model).toBe('gpt-5');
      expect(row.auto_assigned_route).toEqual({
        provider: 'openai',
        authType: 'api_key',
        model: 'gpt-5',
      });
    }
  });

  it('saves the route on existing tier rows that already have a slot', async () => {
    const existing: Partial<TierAssignment>[] = [
      Object.assign(new TierAssignment(), {
        id: 't-simple',
        agent_id: 'agent-1',
        tier: 'simple',
        auto_assigned_model: 'old-model',
        auto_assigned_route: null,
      }),
    ];
    const { svc, save } = makeService({
      models: [
        m({
          id: 'cheap',
          provider: 'openai',
          authType: 'api_key',
          inputPricePerToken: 1,
          outputPricePerToken: 1,
          qualityScore: 1,
        }),
      ],
      existingTiers: existing,
    });

    await svc.recalculate('agent-1');

    const saved = save.mock.calls[0][0] as TierAssignment[];
    const simple = saved.find((t) => t.tier === 'simple')!;
    expect(simple.auto_assigned_model).toBe('cheap');
    expect(simple.auto_assigned_route).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'cheap',
    });
  });

  it('leaves auto_assigned_route null when the picked model has no authType', async () => {
    // Without an authType, buildRoute() returns null and the legacy
    // auto_assigned_model column stays authoritative for routing.
    const { svc, insert } = makeService({
      models: [
        m({
          id: 'mystery',
          provider: 'openai',
          authType: undefined as any,
          inputPricePerToken: 1,
          outputPricePerToken: 1,
          qualityScore: 5,
        }),
      ],
    });

    await svc.recalculate('agent-1');

    const inserted = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    for (const row of inserted) {
      expect(row.auto_assigned_model).toBe('mystery');
      expect(row.auto_assigned_route).toBeNull();
    }
  });

  it('leaves auto_assigned_route null when no models are connected', async () => {
    const { svc, insert } = makeService({ models: [] });

    await svc.recalculate('agent-1');

    const inserted = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    for (const row of inserted) {
      expect(row.auto_assigned_model).toBeNull();
      expect(row.auto_assigned_route).toBeNull();
    }
  });

  it('uses the subscription model route when subscription beats api_key', async () => {
    // filterSubModels keeps the zero-cost subscription model and that beats
    // any api_key model. Verify the route reflects the picked subscription.
    const { svc, insert } = makeService({
      models: [
        m({
          id: 'codex-mini',
          provider: 'openai',
          authType: 'subscription',
          inputPricePerToken: 0,
          outputPricePerToken: 0,
          qualityScore: 5,
          capabilityCode: true,
        }),
        m({
          id: 'gpt-5',
          provider: 'openai',
          authType: 'api_key',
          inputPricePerToken: 5,
          outputPricePerToken: 5,
          qualityScore: 7,
          capabilityCode: true,
        }),
      ],
    });

    await svc.recalculate('agent-1');

    const inserted = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    for (const row of inserted) {
      expect(row.auto_assigned_route).toEqual({
        provider: 'openai',
        authType: 'subscription',
        model: 'codex-mini',
      });
    }
  });
});
