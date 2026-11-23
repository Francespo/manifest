import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import type {
  ModelCatalogConfig,
  ModelCatalogOption,
  ModelCatalogOptions,
  ModelCatalogResponse,
} from 'manifest-shared';
import { ModelCatalogConfigEntity } from '../../entities/model-catalog-config.entity';
import { CustomProvider } from '../../entities/custom-provider.entity';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { openAiModelId } from '../routing-core/public-model-id';

/** Trim blank/duplicate ids and keep first-seen order so saves are deterministic. */
function cleanIds(ids: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids ?? []) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

@Injectable()
export class ModelCatalogConfigService {
  constructor(
    @InjectRepository(ModelCatalogConfigEntity)
    private readonly configRepo: Repository<ModelCatalogConfigEntity>,
    @InjectRepository(CustomProvider)
    private readonly customProviderRepo: Repository<CustomProvider>,
    private readonly modelDiscovery: ModelDiscoveryService,
  ) {}

  /** Read the tenant's selection. A missing row is an empty selection, never an error. */
  async get(tenantId: string): Promise<ModelCatalogConfig> {
    if (!tenantId) return { pool_model_ids: [], custom_provider_ids: [] };
    const row = await this.configRepo.findOne({ where: { tenant_id: tenantId } });
    if (!row) return { pool_model_ids: [], custom_provider_ids: [] };
    return {
      pool_model_ids: cleanIds(row.pool_model_ids),
      custom_provider_ids: cleanIds(row.custom_provider_ids),
    };
  }

  /** Patch and persist. Omitted lists keep their current value. */
  async update(tenantId: string, patch: Partial<ModelCatalogConfig>): Promise<ModelCatalogConfig> {
    const current = await this.get(tenantId);
    const next: ModelCatalogConfig = {
      pool_model_ids:
        patch.pool_model_ids === undefined
          ? current.pool_model_ids
          : cleanIds(patch.pool_model_ids),
      custom_provider_ids:
        patch.custom_provider_ids === undefined
          ? current.custom_provider_ids
          : cleanIds(patch.custom_provider_ids),
    };
    const existing = await this.configRepo.findOne({ where: { tenant_id: tenantId } });
    if (existing) {
      await this.configRepo.update(
        { id: existing.id },
        {
          pool_model_ids: next.pool_model_ids,
          custom_provider_ids: next.custom_provider_ids,
        },
      );
    } else {
      await this.configRepo.insert({
        id: uuid(),
        tenant_id: tenantId,
        pool_model_ids: next.pool_model_ids,
        custom_provider_ids: next.custom_provider_ids,
      });
    }
    return next;
  }

  /** Config plus the choices the dashboard editor offers. */
  async getResponse(tenantId: string): Promise<ModelCatalogResponse> {
    const [config, options] = await Promise.all([this.get(tenantId), this.getOptions(tenantId)]);
    return { ...config, options };
  }

  /** Options are derived, never stored: a new provider/model shows up without a save. */
  async getOptions(tenantId: string): Promise<ModelCatalogOptions> {
    if (!tenantId) return { pool_models: [], custom_providers: [] };
    const [models, customProviders] = await Promise.all([
      this.modelDiscovery.getModelsForAgent(tenantId),
      this.customProviderRepo.find({
        where: { tenant_id: tenantId },
        select: ['id', 'name', 'alias'],
      }),
    ]);

    const byId = new Map<string, ModelCatalogOption>();
    for (const model of models) {
      const id = openAiModelId(model);
      if (!id || id === 'auto' || byId.has(id)) continue;
      byId.set(id, { id, label: model.displayName?.trim() || id });
    }

    return {
      pool_models: [...byId.values()].sort((a, b) => a.label.localeCompare(b.label)),
      custom_providers: customProviders
        .map((provider) => ({
          id: provider.id,
          label: provider.alias || provider.name || provider.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }
}
