import { ModelCatalogConfigService } from './model-catalog-config.service';
import { ModelCatalogModule } from './model-catalog.module';
import { ProxyModule } from '../proxy/proxy.module';

function makeService(options: {
  row?: Record<string, unknown> | null;
  models?: Array<Record<string, unknown>>;
  customProviders?: Array<Record<string, unknown>>;
}) {
  const row = options.row ?? null;
  const configRepo = {
    findOne: jest.fn().mockResolvedValue(row),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const customProviderRepo = {
    find: jest.fn().mockResolvedValue(options.customProviders ?? []),
  };
  const modelDiscovery = {
    getModelsForAgent: jest.fn().mockResolvedValue(options.models ?? []),
  };
  const service = new ModelCatalogConfigService(
    configRepo as never,
    customProviderRepo as never,
    modelDiscovery as never,
  );
  return { service, configRepo, customProviderRepo, modelDiscovery };
}

describe('model catalog DI wiring', () => {
  it('is imported by the proxy so scoped catalogs never silently fall back to empty', () => {
    const imports = Reflect.getMetadata('imports', ProxyModule) as unknown[];
    expect(imports).toContain(ModelCatalogModule);

    const exported = Reflect.getMetadata('exports', ModelCatalogModule) as unknown[];
    expect(exported).toContain(ModelCatalogConfigService);
  });
});

describe('ModelCatalogConfigService', () => {
  it('returns an empty selection when a tenant has no row yet', async () => {
    const { service } = makeService({});
    await expect(service.get('tenant-1')).resolves.toEqual({
      pool_model_ids: [],
      custom_provider_ids: [],
    });
  });

  it('creates a row on first write and updates it afterwards', async () => {
    const { service, configRepo } = makeService({});
    await expect(
      service.update('tenant-1', { pool_model_ids: [' openai/gpt-4o ', 'openai/gpt-4o', ''] }),
    ).resolves.toEqual({ pool_model_ids: ['openai/gpt-4o'], custom_provider_ids: [] });
    expect(configRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        pool_model_ids: ['openai/gpt-4o'],
        custom_provider_ids: [],
      }),
    );

    configRepo.findOne.mockResolvedValue({
      id: 'row-1',
      tenant_id: 'tenant-1',
      pool_model_ids: ['openai/gpt-4o'],
      custom_provider_ids: [],
    });
    await service.update('tenant-1', { custom_provider_ids: ['provider-2'] });
    expect(configRepo.update).toHaveBeenCalledWith(
      { id: 'row-1' },
      { pool_model_ids: ['openai/gpt-4o'], custom_provider_ids: ['provider-2'] },
    );
    expect(configRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('offers discovered public ids and tenant custom providers as options', async () => {
    const { service } = makeService({
      models: [
        {
          id: 'gpt-4o',
          provider: 'openai',
          displayName: 'GPT-4o',
        },
        {
          id: 'custom:provider-1/model-a',
          provider: 'custom:provider-1',
          providerAlias: 'my-bridge',
          displayName: 'Model A',
        },
      ] as never,
      customProviders: [{ id: 'provider-1', name: 'My Bridge', alias: 'my-bridge' }],
    });
    const response = await service.getResponse('tenant-1');
    expect(response.options).toEqual({
      pool_models: [
        { id: 'openai/gpt-4o', label: 'GPT-4o' },
        { id: 'my-bridge/model-a', label: 'Model A' },
      ],
      custom_providers: [{ id: 'provider-1', label: 'my-bridge' }],
    });
  });
});
