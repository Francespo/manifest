import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import type { AuthType, ModelRoute } from 'manifest-shared';
import { SpecificityAssignment } from '../../entities/specificity-assignment.entity';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { RoutingCacheService } from './routing-cache.service';

function unambiguousRoute(model: string, available: DiscoveredModel[]): ModelRoute | null {
  const matches = available.filter((m) => m.id === model);
  if (matches.length !== 1) return null;
  const m = matches[0];
  if (!m.authType) return null;
  return { provider: m.provider, authType: m.authType, model: m.id };
}

function explicitRoute(
  model: string,
  provider: string | undefined,
  authType: AuthType | undefined,
): ModelRoute | null {
  if (!provider || !authType) return null;
  return { provider, authType, model };
}

@Injectable()
export class SpecificityService {
  constructor(
    @InjectRepository(SpecificityAssignment)
    private readonly repo: Repository<SpecificityAssignment>,
    private readonly routingCache: RoutingCacheService,
    private readonly discoveryService: ModelDiscoveryService,
  ) {}

  async getAssignments(agentId: string): Promise<SpecificityAssignment[]> {
    const cached = this.routingCache.getSpecificity(agentId);
    if (cached) return cached;

    const rows = await this.repo.find({ where: { agent_id: agentId } });
    this.routingCache.setSpecificity(agentId, rows);
    return rows;
  }

  async getActiveAssignments(agentId: string): Promise<SpecificityAssignment[]> {
    const all = await this.getAssignments(agentId);
    return all.filter((a) => a.is_active);
  }

  async toggleCategory(
    agentId: string,
    userId: string,
    category: string,
    active: boolean,
  ): Promise<SpecificityAssignment> {
    const existing = await this.repo.findOne({ where: { agent_id: agentId, category } });

    if (existing) {
      existing.is_active = active;
      existing.updated_at = new Date().toISOString();
      await this.repo.save(existing);
      this.routingCache.invalidateAgent(agentId);
      return existing;
    }

    const record = Object.assign(new SpecificityAssignment(), {
      id: randomUUID(),
      user_id: userId,
      agent_id: agentId,
      category,
      is_active: active,
      override_model: null,
      override_provider: null,
      override_auth_type: null,
      auto_assigned_model: null,
      fallback_models: null,
      override_route: null,
      auto_assigned_route: null,
      fallback_routes: null,
    });

    try {
      await this.repo.insert(record);
    } catch {
      const retry = await this.repo.findOne({ where: { agent_id: agentId, category } });
      if (retry) return this.toggleCategory(agentId, userId, category, active);
    }
    this.routingCache.invalidateAgent(agentId);
    return record;
  }

  async setOverride(
    agentId: string,
    userId: string,
    category: string,
    model: string,
    provider?: string,
    authType?: AuthType,
  ): Promise<SpecificityAssignment> {
    const available = await this.discoveryService.getModelsForAgent(agentId);
    const route = explicitRoute(model, provider, authType) ?? unambiguousRoute(model, available);
    const existing = await this.repo.findOne({ where: { agent_id: agentId, category } });

    if (existing) {
      existing.override_model = model;
      existing.override_provider = provider ?? route?.provider ?? null;
      existing.override_auth_type = authType ?? route?.authType ?? null;
      existing.override_route = route;
      existing.is_active = true;
      existing.updated_at = new Date().toISOString();
      await this.repo.save(existing);
      this.routingCache.invalidateAgent(agentId);
      return existing;
    }

    const record = Object.assign(new SpecificityAssignment(), {
      id: randomUUID(),
      user_id: userId,
      agent_id: agentId,
      category,
      is_active: true,
      override_model: model,
      override_provider: provider ?? route?.provider ?? null,
      override_auth_type: authType ?? route?.authType ?? null,
      auto_assigned_model: null,
      fallback_models: null,
      override_route: route,
      auto_assigned_route: null,
      fallback_routes: null,
    });

    try {
      await this.repo.insert(record);
    } catch {
      const retry = await this.repo.findOne({ where: { agent_id: agentId, category } });
      if (retry) return this.setOverride(agentId, userId, category, model, provider, authType);
    }
    this.routingCache.invalidateAgent(agentId);
    return record;
  }

  async clearOverride(agentId: string, category: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { agent_id: agentId, category } });
    if (!existing) return;

    existing.override_model = null;
    existing.override_provider = null;
    existing.override_auth_type = null;
    existing.fallback_models = null;
    existing.override_route = null;
    existing.fallback_routes = null;
    existing.updated_at = new Date().toISOString();
    await this.repo.save(existing);
    this.routingCache.invalidateAgent(agentId);
  }

  async setFallbacks(
    agentId: string,
    category: string,
    models: string[],
    routes?: ModelRoute[],
  ): Promise<string[]> {
    const existing = await this.repo.findOne({ where: { agent_id: agentId, category } });
    if (!existing) return [];
    existing.fallback_models = models.length > 0 ? models : null;
    existing.fallback_routes = await this.buildFallbackRoutes(agentId, models, routes);
    existing.updated_at = new Date().toISOString();
    await this.repo.save(existing);
    this.routingCache.invalidateAgent(agentId);
    return models;
  }

  async clearFallbacks(agentId: string, category: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { agent_id: agentId, category } });
    if (!existing) return;
    existing.fallback_models = null;
    existing.fallback_routes = null;
    existing.updated_at = new Date().toISOString();
    await this.repo.save(existing);
    this.routingCache.invalidateAgent(agentId);
  }

  async resetAll(agentId: string): Promise<void> {
    await this.repo.update(
      { agent_id: agentId },
      {
        is_active: false,
        override_model: null,
        override_provider: null,
        override_auth_type: null,
        fallback_models: null,
        override_route: null,
        fallback_routes: null,
        updated_at: new Date().toISOString(),
      },
    );
    this.routingCache.invalidateAgent(agentId);
  }

  private async buildFallbackRoutes(
    agentId: string,
    models: string[],
    routes?: ModelRoute[],
  ): Promise<ModelRoute[] | null> {
    if (models.length === 0) return null;
    if (routes && routes.length === models.length) {
      const aligned = routes.every((r, i) => r.model === models[i]);
      if (aligned) return routes;
    }
    const available = await this.discoveryService.getModelsForAgent(agentId);
    const resolved: ModelRoute[] = [];
    for (const m of models) {
      const route = unambiguousRoute(m, available);
      if (!route) return null;
      resolved.push(route);
    }
    return resolved;
  }
}
