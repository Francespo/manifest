import { ModelCatalogRefreshService } from '../model-catalog-refresh.service';
import { RoutingCoreModule } from '../routing-core.module';

function makeService(options: { acquired?: boolean; tenants?: Array<{ id: string }> } = {}) {
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return [{ acquired: options.acquired !== false }];
      }
      return [];
    }),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = { createQueryRunner: jest.fn().mockReturnValue(queryRunner) };
  const tenantRepo = {
    find: jest.fn().mockResolvedValue(options.tenants ?? [{ id: 'tenant-1' }, { id: 'tenant-2' }]),
  };
  const discovery = { discoverAllForAgent: jest.fn().mockResolvedValue(undefined) };
  const modelsDevSync = { refreshCache: jest.fn().mockResolvedValue(undefined) };
  const routingCache = { invalidateTenant: jest.fn() };
  const service = new ModelCatalogRefreshService(
    dataSource as never,
    tenantRepo as never,
    discovery as never,
    modelsDevSync as never,
    routingCache as never,
  );
  return { service, queryRunner, discovery, modelsDevSync, routingCache, tenantRepo };
}

describe('ModelCatalogRefreshService', () => {
  it('is registered in the module that owns discovery and the routing cache', () => {
    const providers = Reflect.getMetadata('providers', RoutingCoreModule) as unknown[];
    expect(providers).toContain(ModelCatalogRefreshService);
  });

  it('is scheduled twice a day at 00:00 and 12:00', () => {
    const cron = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      ModelCatalogRefreshService.prototype.refreshAllTenants,
    );
    expect(cron).toEqual(
      expect.objectContaining({
        cronTime: '0 0,12 * * *',
        name: 'model-catalog-refresh',
        waitForCompletion: true,
      }),
    );
  });

  it('skips the whole tick when another replica holds the lock', async () => {
    const { service, discovery, queryRunner } = makeService({ acquired: false });
    await expect(service.refreshAllTenants()).resolves.toBe(0);
    expect(discovery.discoverAllForAgent).not.toHaveBeenCalled();
    expect(queryRunner.query).not.toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
    );
  });

  it('refreshes models.dev once, then every active tenant and its routing cache', async () => {
    const { service, discovery, modelsDevSync, routingCache, queryRunner } = makeService();
    await expect(service.refreshAllTenants()).resolves.toBe(2);
    expect(modelsDevSync.refreshCache).toHaveBeenCalledTimes(1);
    expect(discovery.discoverAllForAgent).toHaveBeenCalledTimes(2);
    expect(discovery.discoverAllForAgent).toHaveBeenCalledWith('tenant-1', {
      forceRefresh: true,
      skipModelsDevRefresh: true,
    });
    expect(routingCache.invalidateTenant).toHaveBeenCalledWith('tenant-1');
    expect(routingCache.invalidateTenant).toHaveBeenCalledWith('tenant-2');
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'));
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('keeps going when one tenant fails', async () => {
    const { service, discovery } = makeService();
    discovery.discoverAllForAgent.mockRejectedValueOnce(new Error('provider down'));
    await expect(service.refreshAllTenants()).resolves.toBe(1);
    expect(discovery.discoverAllForAgent).toHaveBeenCalledTimes(2);
  });
});
