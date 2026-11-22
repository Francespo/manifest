import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ModelEgressPolicy } from '../../entities/model-egress-policy.entity';
import { defaultModelEgress, ModelEgressPolicyService } from './model-egress-policy.service';
import type { RoutingCacheService } from './routing-cache.service';

function makeRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(),
  } as unknown as jest.Mocked<Repository<ModelEgressPolicy>>;
}

function makeCache() {
  return {
    getModelEgressPolicies: jest.fn().mockReturnValue(null),
    setModelEgressPolicies: jest.fn(),
    invalidateModelEgressPolicies: jest.fn(),
  } as unknown as jest.Mocked<RoutingCacheService>;
}

function upsertBuilder() {
  const builder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orUpdate: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };
  return builder;
}

describe('defaultModelEgress', () => {
  it('auto-routes Crouton Alpha through the US gateway', () => {
    expect(defaultModelEgress('opencode-go', 'crouton-alpha-free')).toBe('us');
    expect(defaultModelEgress('opencode-zen', 'crouton-alpha-free')).toBe('us');
  });

  it('leaves Muse Spark direct — Meta policy allows the EU', () => {
    expect(defaultModelEgress('opencode-go', 'muse-spark-1.2-contributor')).toBe('direct');
    expect(defaultModelEgress('opencode-zen', 'muse-spark-1.3')).toBe('direct');
  });

  it('never applies US egress to a provider without the capability', () => {
    expect(defaultModelEgress('anthropic', 'crouton-alpha-free')).toBe('direct');
  });
});

describe('ModelEgressPolicyService', () => {
  let repo: jest.Mocked<Repository<ModelEgressPolicy>>;
  let cache: jest.Mocked<RoutingCacheService>;
  let service: ModelEgressPolicyService;

  beforeEach(() => {
    repo = makeRepo();
    cache = makeCache();
    service = new ModelEgressPolicyService(repo, cache);
  });

  it('resolve falls back to the model default when no row exists', async () => {
    await expect(
      service.resolve('t1', 'opencode-go', 'subscription', 'crouton-alpha-free'),
    ).resolves.toBe('us');
    await expect(
      service.resolve('t1', 'opencode-go', 'subscription', 'muse-spark-1.2'),
    ).resolves.toBe('direct');
  });

  it('resolve returns direct without a tenant or for unsupported providers', async () => {
    await expect(
      service.resolve(null, 'opencode-go', 'subscription', 'crouton-alpha-free'),
    ).resolves.toBe('direct');
    await expect(service.resolve('t1', 'anthropic', 'api_key', 'crouton-alpha-free')).resolves.toBe(
      'direct',
    );
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('explicit policy overrides the default', async () => {
    repo.find.mockResolvedValue([
      {
        provider: 'opencode-go',
        auth_type: 'subscription',
        model: 'crouton-alpha-free',
        egress: 'direct',
      } as ModelEgressPolicy,
    ]);
    await expect(
      service.resolve('t1', 'opencode-go', 'subscription', 'crouton-alpha-free'),
    ).resolves.toBe('direct');
  });

  it('set writes an upsert and invalidates the tenant cache', async () => {
    const builder = upsertBuilder();
    repo.createQueryBuilder.mockReturnValue(builder as never);

    await expect(
      service.set('t1', 'OpenCode-Go', 'subscription', 'muse-spark-1.2', 'us'),
    ).resolves.toBe('us');

    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 't1',
        provider: 'opencode-go',
        auth_type: 'subscription',
        model: 'muse-spark-1.2',
        egress: 'us',
      }),
    );
    expect(builder.orUpdate).toHaveBeenCalledWith(
      ['egress', 'updated_at'],
      ['tenant_id', 'provider', 'auth_type', 'model'],
    );
    expect(cache.invalidateModelEgressPolicies).toHaveBeenCalledWith('t1');
  });

  it('stores prefixed and bare route models under the same key', async () => {
    const builder = upsertBuilder();
    repo.createQueryBuilder.mockReturnValue(builder as never);

    await service.set(
      't1',
      'opencode-go',
      'subscription',
      'opencode-go/crouton-alpha-free',
      'direct',
    );

    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'crouton-alpha-free', egress: 'direct' }),
    );
  });

  it('set auto deletes the explicit row', async () => {
    await service.set('t1', 'opencode-go', 'subscription', 'crouton-alpha-free', 'auto');

    expect(repo.delete).toHaveBeenCalledWith({
      tenant_id: 't1',
      provider: 'opencode-go',
      auth_type: 'subscription',
      model: 'crouton-alpha-free',
    });
    expect(cache.invalidateModelEgressPolicies).toHaveBeenCalledWith('t1');
  });

  it('rejects a policy on a provider without US egress', async () => {
    await expect(
      service.set('t1', 'anthropic', 'api_key', 'claude-sonnet-4.5', 'us'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('overview merges explicit policies into the model defaults', async () => {
    repo.find.mockResolvedValue([
      {
        provider: 'opencode-go',
        auth_type: 'subscription',
        model: 'muse-spark-1.2',
        egress: 'us',
      } as ModelEgressPolicy,
    ]);

    const rows = await service.overview('t1', 'opencode-go', 'subscription', [
      { id: 'muse-spark-1.2', displayName: 'Muse Spark 1.2' },
      { id: 'crouton-alpha-free', displayName: 'Crouton Alpha Free' },
    ]);

    expect(rows).toEqual([
      {
        model: 'crouton-alpha-free',
        display_name: 'Crouton Alpha Free',
        egress: 'us',
        explicit: false,
      },
      {
        model: 'muse-spark-1.2',
        display_name: 'Muse Spark 1.2',
        egress: 'us',
        explicit: true,
      },
    ]);
  });
});
