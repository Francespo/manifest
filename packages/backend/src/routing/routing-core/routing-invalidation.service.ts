import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TierAssignment } from '../../entities/tier-assignment.entity';
import { ModelPricingCacheService } from '../../model-prices/model-pricing-cache.service';
import { TierAutoAssignService } from './tier-auto-assign.service';
import { RoutingCacheService } from './routing-cache.service';

@Injectable()
export class RoutingInvalidationService {
  private readonly logger = new Logger(RoutingInvalidationService.name);

  constructor(
    @InjectRepository(TierAssignment)
    private readonly tierRepo: Repository<TierAssignment>,
    private readonly pricingCache: ModelPricingCacheService,
    private readonly autoAssign: TierAutoAssignService,
    private readonly routingCache: RoutingCacheService,
  ) {}

  /**
   * Clears overrides and fallback entries for models that have been removed
   * from the pricing database (e.g. after a pricing sync).
   */
  async invalidateOverridesForRemovedModels(removedModels: string[]): Promise<void> {
    if (removedModels.length === 0) return;

    const removedSet = new Set(removedModels);

    const affected = await this.tierRepo.find({
      where: { override_model: In(removedModels) },
    });

    const agentIds = new Set<string>();
    const tiersToSave: TierAssignment[] = [];
    for (const tier of affected) {
      this.logger.warn(
        `Clearing override ${tier.override_model} for agent ${tier.agent_id} tier ${tier.tier} (model removed)`,
      );
      tier.override_model = null;
      tier.override_provider = null;
      tier.override_auth_type = null;
      tier.override_route = null;
      tier.updated_at = new Date().toISOString();
      tiersToSave.push(tier);
      agentIds.add(tier.agent_id);
    }

    // Also clean fallback models referencing removed models.
    // Scope to affected agents first; if none found, scan all tiers with fallbacks.
    const fallbackTiers =
      agentIds.size > 0
        ? await this.tierRepo.find({ where: { agent_id: In([...agentIds]) } })
        : await this.tierRepo.find();
    const savedIds = new Set(tiersToSave.map((t) => t.id));
    for (const tier of fallbackTiers) {
      const hasLegacyFallbacks = tier.fallback_models && tier.fallback_models.length > 0;
      const hasRouteFallbacks = tier.fallback_routes && tier.fallback_routes.length > 0;
      if (!hasLegacyFallbacks && !hasRouteFallbacks) continue;
      let mutated = false;
      if (tier.fallback_models && tier.fallback_models.length > 0) {
        const filtered = tier.fallback_models.filter((m) => !removedSet.has(m));
        if (filtered.length !== tier.fallback_models.length) {
          tier.fallback_models = filtered.length > 0 ? filtered : null;
          mutated = true;
        }
      }
      if (tier.fallback_routes && tier.fallback_routes.length > 0) {
        const filteredRoutes = tier.fallback_routes.filter((r) => !removedSet.has(r.model));
        if (filteredRoutes.length !== tier.fallback_routes.length) {
          tier.fallback_routes = filteredRoutes.length > 0 ? filteredRoutes : null;
          mutated = true;
        }
      }
      // If the override on the same tier was just cleared above, override_route
      // is already null. Also drop override_route here when its model name is
      // in removedSet — covers rows where the legacy override columns happened
      // to be null but override_route was populated by a later mutation.
      if (tier.override_route && removedSet.has(tier.override_route.model)) {
        tier.override_route = null;
        mutated = true;
      }
      if (mutated) {
        tier.updated_at = new Date().toISOString();
        if (!savedIds.has(tier.id)) tiersToSave.push(tier);
        agentIds.add(tier.agent_id);
      }
    }

    // Batch save all tier mutations
    if (tiersToSave.length > 0) await this.tierRepo.save(tiersToSave);

    if (agentIds.size === 0) return;

    // Parallel recalculate + cache invalidation
    await Promise.all(
      [...agentIds].map((agentId) => {
        this.routingCache.invalidateAgent(agentId);
        return this.autoAssign.recalculate(agentId);
      }),
    );

    this.logger.log(
      `Invalidated ${affected.length} overrides for ${agentIds.size} agents (removed models: ${removedModels.join(', ')})`,
    );
  }
}
