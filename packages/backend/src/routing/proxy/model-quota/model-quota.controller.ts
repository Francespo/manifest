import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Repository } from 'typeorm';
import type { KeyQuotaBucketStatus, ModelQuotaStatusResponse } from 'manifest-shared';
import { TenantCtx, TenantContext } from '../../../common/decorators/tenant-context.decorator';
import { TenantProvider } from '../../../entities/tenant-provider.entity';
import { AgentMessage } from '../../../entities/agent-message.entity';
import { ModelQuotaLimiterService } from './model-quota-limiter.service';
import { findQuotaRule } from './default-model-quotas';

/**
 * Hydrates the live in-memory quota buckets with "configured" rows derived
 * from each tenant's active provider connections + cached model discovery.
 *
 * Before any traffic flows the limiter's in-memory bucket map is empty, so the
 * dashboard would otherwise show "No active quota buckets". By reading
 * `tenant_providers.cached_models` we can render the RPM/TPM/RPD limits for
 * every configured (provider, key, model) up front, then overlay live usage
 * (rpmUsed/tpmUsed/rpdUsed/status/frozenUntil/freezeReason/lastUsedAt) whenever
 * an in-memory bucket shares the same
 * `${provider}:${modelFamily}:${keyIdentity}` identity.
 *
 * The table is small (one row per connected provider key) so a straightforward
 * `repo.find` per request is fine — the same pattern other config endpoints use.
 */
@Controller('api/v1/model-quotas')
export class ModelQuotaController {
  constructor(
    private readonly quotaLimiter: ModelQuotaLimiterService,
    @InjectRepository(TenantProvider)
    private readonly tenantProviderRepo: Repository<TenantProvider>,
    private readonly dataSource: DataSource,
  ) {}

  @Get('status')
  async getStatus(@TenantCtx() ctx: TenantContext): Promise<ModelQuotaStatusResponse> {
    const liveBuckets = this.quotaLimiter.getAllBucketStatuses();

    // Loopback / env-key callers have no tenant context: fall back to showing
    // every active provider connection so curl/self-hosted loopback still works.
    const providers = await this.tenantProviderRepo.find({
      where: ctx.tenantId ? { tenant_id: ctx.tenantId, is_active: true } : { is_active: true },
    });

    // Hydrated windowed usage from agent_messages: per (provider, model,
    // tenant_provider_id, keyLabel), computed over the same UTC day / 60s
    // windows the pre-flight quota limiter uses. This lets the UI show
    // per-key/per-model token consumption for every provider (not just
    // Gemini) even though only Gemini has hard-capped RPM/TPM/RPD rules.
    const hydratedUsage = await this.queryHydratedUsage(ctx.tenantId);

    // Configured rows keyed by the same identity the limiter uses so live
    // usage can be overlaid on top. Usage is hydrated from DB (per-day and
    // 60s windows) so it survives restarts; the in-memory live map overlays
    // active cooldowns/frozen state on top afterward. Generates rows for EVERY
    // provider/key/model present in the DB (derived from
    // tenant_providers.cached_models), so adding/removing keys or adding
    // models (Flash/Flash-Lite future versions via regex families) is reflected
    // live — no hardcoded model/provider list.
    const configuredByKey = new Map<string, KeyQuotaBucketStatus>();
    for (const row of providers) {
      if (row.is_active === false) continue;
      const models = Array.isArray(row.cached_models) ? row.cached_models : [];
      const bucketedModelIds = new Set<string>();
      for (const model of models) {
        const rule = findQuotaRule(row.provider, model.id);
        const modelFamily =
          rule?.modelFamily ??
          // For non-Gemini providers: keep a stable family per model id so
          // consumption can be tracked per (provider, key, model) for all
          // providers, not just Gemini.
          model.id.toLowerCase();
        const keyIdentity = `tp_${row.id.slice(0, 16)}`;
        const bucketKey = `${row.provider.toLowerCase()}:${modelFamily}:${keyIdentity}`;
        if (bucketedModelIds.has(bucketKey)) continue;
        bucketedModelIds.add(bucketKey);
        const usageKey = `${row.provider.toLowerCase()}::${model.id.toLowerCase()}::${row.id}`;
        const usage = hydratedUsage.get(usageKey);
        configuredByKey.set(bucketKey, {
          provider: row.provider.toLowerCase(),
          model: model.id,
          modelFamily,
          keyLabel: row.label || 'Default',
          keyIdentity,
          rpmUsed: usage?.rpm ?? 0,
          rpmLimit: rule?.maxRpm ?? null,
          tpmUsed: usage?.tpm ?? 0,
          tpmLimit: rule?.maxTpm ?? null,
          rpdUsed: usage?.rpd ?? 0,
          rpdLimit: rule?.maxRpd ?? null,
          frozenUntil: null,
          freezeReason: null,
          status: 'active',
          lastUsedAt: usage?.lastUsedAt ?? null,
        });
      }
    }

    const merged = new Map(configuredByKey);
    for (const live of liveBuckets) {
      const existing = merged.get(`${live.provider}:${live.modelFamily}:${live.keyIdentity}`);
      if (existing) {
        // Overlay live usage/state onto the configured limits row.
        existing.rpmUsed = live.rpmUsed;
        existing.tpmUsed = live.tpmUsed;
        existing.rpdUsed = live.rpdUsed;
        existing.status = live.status;
        existing.frozenUntil = live.frozenUntil;
        existing.freezeReason = live.freezeReason;
        existing.lastUsedAt = live.lastUsedAt;
      } else {
        // Live bucket with no configured provider row (e.g. openai gpt-4o):
        // keep it as-is, rule-derived limits or null.
        merged.set(`${live.provider}:${live.modelFamily}:${live.keyIdentity}`, live);
      }
    }

    const buckets = Array.from(merged.values()).sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
    );

    return {
      buckets,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Aggregate per-key/per-model windowed usage from agent_messages for the
   * current UTC day window (RPD) and the rolling 60s windows (RPM/TPM).
   * Keyed by `${providerLower}::${modelLower}::${tenantProviderId}` so the
   * caller can attach usage to the right `(provider, key, model)` configured
   * bucket. All counts are row-level DB counts (every agent_messages row
   * corresponds to a completed provider attempt), so no tenant-loopback
   * loopholes leak in via in-memory state alone.
   */
  private async queryHydratedUsage(
    tenantId: string | null,
  ): Promise<Map<string, { rpd: number; rpm: number; tpm: number; lastUsedAt: string | null }>> {
    const out = new Map<
      string,
      { rpd: number; rpm: number; tpm: number; lastUsedAt: string | null }
    >();
    if (!tenantId) return out;
    const rows: Array<{
      row_provider: string;
      row_model: string;
      row_tenant_provider_id: string | null;
      rpd: string | number | null;
      rpm: string | number | null;
      tpm: string | number | null;
      last_used_at: string | null;
    }> = await this.dataSource
      .getRepository(AgentMessage)
      .createQueryBuilder('am')
      .select('am.provider', 'row_provider')
      .addSelect('am.model', 'row_model')
      .addSelect('am.tenant_provider_id', 'row_tenant_provider_id')
      .addSelect('COUNT(*) FILTER (WHERE am.timestamp::date = CURRENT_DATE)', 'rpd')
      .addSelect("COUNT(*) FILTER (WHERE am.timestamp >= NOW() - INTERVAL '60 seconds')", 'rpm')
      .addSelect(
        "COALESCE(SUM((am.input_tokens + am.output_tokens) * 1) FILTER (WHERE am.timestamp >= NOW() - INTERVAL '60 seconds'), 0)",
        'tpm',
      )
      .addSelect('MAX(am.timestamp)', 'last_used_at')
      .where('am.tenant_id = :tenantId', { tenantId })
      .andWhere('am.model IS NOT NULL')
      .andWhere("am.model != ''")
      .andWhere('am.tenant_provider_id IS NOT NULL')
      .andWhere("am.provider != ''")
      .groupBy('am.provider')
      .addGroupBy('am.model')
      .addGroupBy('am.tenant_provider_id')
      .getRawMany();
    for (const r of rows) {
      const provider = String(r.row_provider ?? '').toLowerCase();
      const model = String(r.row_model ?? '').toLowerCase();
      const tpid = String(r.row_tenant_provider_id ?? '');
      const rpd = Number(r.rpd ?? 0) || 0;
      const rpm = Number(r.rpm ?? 0) || 0;
      const tpm = Number(r.tpm ?? 0) || 0;
      const lastUsedAt = r.last_used_at ? new Date(r.last_used_at).toISOString() : null;
      out.set(`${provider}::${model}::${tpid}`, { rpd, rpm, tpm, lastUsedAt });
    }
    return out;
  }
}
