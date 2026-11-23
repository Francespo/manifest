import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  SHARED_PROVIDER_BY_ID_OR_ALIAS,
  supportsUsEgress,
  type AuthType,
  type ModelEgress,
  type ModelEgressSetting,
} from 'manifest-shared';
import { ModelEgressPolicy } from '../../entities/model-egress-policy.entity';
import { RoutingCacheService } from './routing-cache.service';

export interface ModelEgressPolicyView {
  model: string;
  display_name: string | null;
  /** Effective value — explicit policy, or the provider/model default. */
  egress: ModelEgress;
  /** True when the user set this value instead of inheriting the default. */
  explicit: boolean;
}

const DEFAULT_AUTH_TYPE: AuthType = 'api_key';

/**
 * Models that are region-gated today. Keep this list deliberately small and
 * explicit: a broad heuristic would silently move healthy traffic through the
 * gateway. Crouton Alpha is the current stealth model that rejects EU traffic.
 *
 * Muse Spark is NOT here anymore: Meta's Geographic Use Policy (updated
 * 2026-10-12) lists the restricted territories and does not include the EU or
 * Italy, so Muse can go direct unless a user opts it into US routing.
 */
const AUTO_US_MODEL_PATTERNS: readonly RegExp[] = [/crouton/i];

function canonicalProvider(provider: string): string {
  const lower = provider.toLowerCase().trim();
  return SHARED_PROVIDER_BY_ID_OR_ALIAS.get(lower)?.id ?? lower;
}

/**
 * The same route model can arrive prefixed (`opencode-go/crouton-alpha-free`,
 * as the picker stores it) or bare (a caller hitting /v1 directly). The policy
 * key must not depend on which spelling was used, so strip only the provider's
 * own namespace.
 */
function normalizeModel(provider: string, model: string): string {
  const prefix = `${canonicalProvider(provider)}/`;
  return model.toLowerCase().startsWith(prefix) ? model.slice(prefix.length) : model;
}

function policyKey(provider: string, authType: string, model: string): string {
  return [canonicalProvider(provider), authType, normalizeModel(provider, model)].join('\u0000');
}

/** Default egress for a model when the tenant has no explicit policy. */
export function defaultModelEgress(provider: string, model: string): ModelEgress {
  if (!supportsUsEgress(provider)) return 'direct';
  return AUTO_US_MODEL_PATTERNS.some((pattern) => pattern.test(model)) ? 'us' : 'direct';
}

@Injectable()
export class ModelEgressPolicyService {
  constructor(
    @InjectRepository(ModelEgressPolicy)
    private readonly repo: Repository<ModelEgressPolicy>,
    private readonly cache: RoutingCacheService,
  ) {}

  /**
   * Explicit policy rows for a tenant, keyed by provider/auth/model. Cached
   * alongside the routing config so the proxy hot path does not hit Postgres
   * on every request.
   */
  async explicitPolicies(tenantId: string): Promise<Map<string, ModelEgress>> {
    const cached = this.cache.getModelEgressPolicies(tenantId);
    const rows = cached ?? (await this.repo.find({ where: { tenant_id: tenantId } }));
    if (!cached) this.cache.setModelEgressPolicies(tenantId, rows);

    const out = new Map<string, ModelEgress>();
    for (const row of rows) {
      out.set(policyKey(row.provider, row.auth_type, row.model), row.egress);
    }
    return out;
  }

  /** Effective egress for one route, honouring explicit policy then defaults. */
  async resolve(
    tenantId: string | null | undefined,
    provider: string,
    authType: string | null | undefined,
    model: string,
  ): Promise<ModelEgress> {
    if (!tenantId || !supportsUsEgress(provider)) return 'direct';
    const policies = await this.explicitPolicies(tenantId);
    return (
      policies.get(policyKey(provider, authType ?? DEFAULT_AUTH_TYPE, model)) ??
      defaultModelEgress(provider, model)
    );
  }

  /** Effective policy for every model in a provider connection group. */
  async overview(
    tenantId: string,
    provider: string,
    authType: string,
    models: ReadonlyArray<{ id: string; displayName?: string | null }>,
  ): Promise<ModelEgressPolicyView[]> {
    if (!supportsUsEgress(provider)) return [];
    const policies = await this.explicitPolicies(tenantId);
    return [...models]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((model) => {
        const explicit = policies.get(policyKey(provider, authType, model.id));
        return {
          model: model.id,
          display_name: model.displayName ?? null,
          egress: explicit ?? defaultModelEgress(provider, model.id),
          explicit: explicit !== undefined,
        };
      });
  }

  /**
   * Write an explicit policy. `auto` deletes the row so the default applies
   * again. Unsupported providers are rejected here rather than in the
   * controller so CLI/MCP callers get the same guard.
   */
  async set(
    tenantId: string,
    provider: string,
    authType: AuthType,
    model: string,
    setting: ModelEgressSetting,
  ): Promise<ModelEgress> {
    const canonical = canonicalProvider(provider);
    if (!supportsUsEgress(canonical)) {
      throw new BadRequestException(`US egress is not supported for provider "${provider}"`);
    }

    const storedModel = normalizeModel(canonical, model);
    if (setting === 'auto') {
      await this.repo.delete({
        tenant_id: tenantId,
        provider: canonical,
        auth_type: authType,
        model: storedModel,
      });
      this.cache.invalidateModelEgressPolicies(tenantId);
      return defaultModelEgress(canonical, model);
    }

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(ModelEgressPolicy)
      .values({
        id: randomUUID(),
        tenant_id: tenantId,
        provider: canonical,
        auth_type: authType,
        model: storedModel,
        egress: setting,
      })
      .orUpdate(['egress', 'updated_at'], ['tenant_id', 'provider', 'auth_type', 'model'])
      .setParameter('updated_at', new Date().toISOString())
      .execute();
    this.cache.invalidateModelEgressPolicies(tenantId);
    return setting;
  }
}
