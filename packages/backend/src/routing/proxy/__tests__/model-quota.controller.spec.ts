import { Repository } from 'typeorm';
import type { KeyQuotaBucketStatus } from 'manifest-shared';
import { ModelQuotaController } from '../model-quota/model-quota.controller';
import { ModelQuotaLimiterService } from '../model-quota/model-quota-limiter.service';
import { TenantProvider } from '../../../entities/tenant-provider.entity';

function makeConfiguredRow(overrides: Partial<TenantProvider> = {}): TenantProvider {
  return {
    id: 'tp-1234567890abcdef',
    tenant_id: 'tenant-1',
    created_by_user_id: null,
    agent_id: null,
    provider: 'google',
    api_key_encrypted: 'enc:xxx',
    key_prefix: null,
    auth_type: 'api_key',
    label: 'Mario',
    priority: 0,
    region: null,
    is_active: true,
    connected_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    cached_models: null,
    models_fetched_at: null,
    ...overrides,
  } as TenantProvider;
}

function makeLiveBucket(overrides: Partial<KeyQuotaBucketStatus> = {}): KeyQuotaBucketStatus {
  return {
    provider: 'google',
    model: 'gemini-2.5-flash',
    modelFamily: 'gemini-flash',
    keyLabel: 'Mario',
    keyIdentity: 'tp_1234567890abcdef',
    rpmUsed: 3,
    rpmLimit: 5,
    tpmUsed: 12_000,
    tpmLimit: 250_000,
    rpdUsed: 7,
    rpdLimit: 20,
    frozenUntil: null,
    freezeReason: null,
    status: 'active',
    lastUsedAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

describe('ModelQuotaController', () => {
  let controller: ModelQuotaController;
  let limiter: jest.Mocked<Pick<ModelQuotaLimiterService, 'getAllBucketStatuses'>>;
  let providerRepo: jest.Mocked<Pick<Repository<TenantProvider>, 'find'>>;

  beforeEach(() => {
    limiter = { getAllBucketStatuses: jest.fn().mockReturnValue([]) };
    providerRepo = { find: jest.fn().mockResolvedValue([]) };
    controller = new ModelQuotaController(
      limiter as unknown as ModelQuotaLimiterService,
      providerRepo as unknown as Repository<TenantProvider>,
    );
  });

  it('builds configured rows with rule limits and zero usage for active gemini providers', async () => {
    providerRepo.find.mockResolvedValue([
      makeConfiguredRow({
        id: 'tp-gemini-key-0000001',
        provider: 'google',
        label: 'Mario',
        cached_models: [
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            provider: 'google',
          },
          {
            id: 'gemini-3.5-flash-lite',
            displayName: 'Gemini 3.5 Flash Lite',
            provider: 'google',
          },
        ] as TenantProvider['cached_models'],
      }),
    ]);

    const result = await controller.getStatus({ tenantId: 'tenant-1', userId: 'user-1' });

    expect(providerRepo.find).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', is_active: true },
    });
    expect(result.buckets).toHaveLength(2);

    const flash = result.buckets.find((b) => b.model === 'gemini-2.5-flash');
    expect(flash).toEqual(
      expect.objectContaining({
        provider: 'google',
        modelFamily: 'gemini-flash',
        keyLabel: 'Mario',
        keyIdentity: 'tp_tp-gemini-key-00',
        rpmUsed: 0,
        rpmLimit: 5,
        tpmUsed: 0,
        tpmLimit: 250_000,
        rpdUsed: 0,
        rpdLimit: 20,
        frozenUntil: null,
        freezeReason: null,
        status: 'active',
        lastUsedAt: null,
      }),
    );

    const flashLite = result.buckets.find((b) => b.model === 'gemini-3.5-flash-lite');
    expect(flashLite).toEqual(
      expect.objectContaining({
        modelFamily: 'gemini-flash-lite',
        rpmLimit: 15,
        rpdLimit: 500,
        tpmLimit: 250_000,
      }),
    );
  });

  it('overlays live usage onto a matching configured row', async () => {
    providerRepo.find.mockResolvedValue([
      makeConfiguredRow({
        id: 'tp-gemini-key-0000001',
        provider: 'google',
        label: 'Mario',
        cached_models: [
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            provider: 'google',
          },
        ] as TenantProvider['cached_models'],
      }),
    ]);
    limiter.getAllBucketStatuses.mockReturnValue([
      makeLiveBucket({
        modelFamily: 'gemini-flash',
        keyIdentity: 'tp_tp-gemini-key-00',
        rpmUsed: 4,
        tpmUsed: 88_000,
        rpdUsed: 12,
        status: 'cooldown',
        frozenUntil: 1_770_000_000_000,
        freezeReason: 'Rate limited (RPM/TPM burst)',
        lastUsedAt: '2026-01-03T00:00:00.000Z',
      }),
    ]);

    const result = await controller.getStatus({ tenantId: 'tenant-1', userId: 'user-1' });

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toEqual(
      expect.objectContaining({
        provider: 'google',
        model: 'gemini-2.5-flash',
        modelFamily: 'gemini-flash',
        rpmUsed: 4,
        rpmLimit: 5,
        tpmUsed: 88_000,
        tpmLimit: 250_000,
        rpdUsed: 12,
        rpdLimit: 20,
        status: 'cooldown',
        frozenUntil: 1_770_000_000_000,
        freezeReason: 'Rate limited (RPM/TPM burst)',
        lastUsedAt: '2026-01-03T00:00:00.000Z',
      }),
    );
  });

  it('keeps live buckets with no configured row and null limits', async () => {
    providerRepo.find.mockResolvedValue([makeConfiguredRow({})]);
    limiter.getAllBucketStatuses.mockReturnValue([
      makeLiveBucket({
        provider: 'openai',
        model: 'gpt-4o',
        modelFamily: 'gpt-4o',
        keyLabel: 'WorkOpenAI',
        keyIdentity: 'lbl_WorkOpenAI',
        rpmLimit: null,
        tpmLimit: null,
        rpdLimit: null,
      }),
    ]);

    const result = await controller.getStatus({ tenantId: 'tenant-1', userId: 'user-1' });

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toEqual(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o',
        rpmLimit: null,
        tpmLimit: null,
        rpdLimit: null,
        rpmUsed: 3,
        rpdUsed: 7,
      }),
    );
  });

  it('applies the tenant filter and ignores other tenants', async () => {
    providerRepo.find.mockImplementation(async (opts) => {
      const tenantId = (opts as { where?: { tenant_id?: string } })?.where?.tenant_id;
      if (tenantId === 'tenant-1') {
        return [
          makeConfiguredRow({
            id: 'tp-gemini-key-0000001',
            tenant_id: 'tenant-1',
            provider: 'google',
            cached_models: [
              {
                id: 'gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                provider: 'google',
              },
            ] as TenantProvider['cached_models'],
          }),
        ];
      }
      return [];
    });
    limiter.getAllBucketStatuses.mockReturnValue([
      makeLiveBucket({
        provider: 'google',
        model: 'gemini-2.5-flash',
        keyIdentity: 'tp_other-tenant-key-00000',
      }),
    ]);

    const result = await controller.getStatus({ tenantId: 'tenant-2', userId: 'user-1' });

    expect(providerRepo.find).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-2', is_active: true },
    });
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toEqual(
      expect.objectContaining({
        provider: 'google',
        model: 'gemini-2.5-flash',
        keyIdentity: 'tp_other-tenant-key-00000',
      }),
    );
  });

  it('ignores inactive providers', async () => {
    providerRepo.find.mockResolvedValue([
      makeConfiguredRow({
        id: 'tp-gemini-key-0000001',
        is_active: false,
        cached_models: [
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            provider: 'google',
          },
        ] as TenantProvider['cached_models'],
      }),
    ]);

    const result = await controller.getStatus({ tenantId: 'tenant-1', userId: 'user-1' });

    expect(result.buckets).toHaveLength(0);
  });

  it('falls back to all active providers when tenant context is absent', async () => {
    providerRepo.find.mockResolvedValue([
      makeConfiguredRow({
        id: 'tp-gemini-key-0000001',
        provider: 'gemini',
        label: 'Default',
        cached_models: [
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            provider: 'gemini',
          },
        ] as TenantProvider['cached_models'],
      }),
    ]);

    const result = await controller.getStatus({ tenantId: null, userId: null });

    expect(providerRepo.find).toHaveBeenCalledWith({ where: { is_active: true } });
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toEqual(
      expect.objectContaining({
        provider: 'gemini',
        keyLabel: 'Default',
        rpmLimit: 5,
      }),
    );
  });
});
