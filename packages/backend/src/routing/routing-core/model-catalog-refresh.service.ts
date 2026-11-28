import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from '../../entities/tenant.entity';
import { ModelsDevSyncService } from '../../database/models-dev-sync.service';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { RoutingCacheService } from './routing-cache.service';

/**
 * Process-wide advisory lock. Manifest can run several replicas, and without
 * this each one would fire the same 00:00 / 12:00 refresh against every
 * provider at once. One winner does the work; the others skip the tick.
 */
const REFRESH_LOCK_KEY = 4011987;
const TRY_LOCK_SQL = `SELECT pg_try_advisory_lock(${REFRESH_LOCK_KEY}::bigint) AS acquired`;
const UNLOCK_SQL = `SELECT pg_advisory_unlock(${REFRESH_LOCK_KEY}::bigint)`;

/**
 * Twice-daily refresh of the model catalog, tenant by tenant.
 *
 * This is the scheduled twin of `POST /api/v1/providers/refresh-models`: it
 * force-refreshes every active connection with native discovery. Hand-added
 * (custom) providers are intentionally untouched — their model lists are
 * curated by the user, not fetched from a provider API.
 */
@Injectable()
export class ModelCatalogRefreshService {
  private readonly logger = new Logger(ModelCatalogRefreshService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly discovery: ModelDiscoveryService,
    private readonly modelsDevSync: ModelsDevSyncService,
    private readonly routingCache: RoutingCacheService,
  ) {}

  @Cron('0 0,12 * * *', { name: 'model-catalog-refresh', waitForCompletion: true })
  async refreshAllTenants(): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    let acquired = false;
    try {
      await queryRunner.connect();
      const rows = (await queryRunner.query(TRY_LOCK_SQL)) as Array<{ acquired?: boolean }>;
      acquired = rows[0]?.acquired === true;
      if (!acquired) return 0;

      // models.dev is instance-wide: refresh it once instead of once per tenant.
      try {
        await this.modelsDevSync.refreshCache();
      } catch (err: unknown) {
        this.logger.warn(`models.dev refresh failed during scheduled catalog refresh: ${err}`);
      }

      const tenants = await this.tenantRepo.find({
        where: { is_active: true },
        select: ['id'],
      });
      let refreshed = 0;
      for (const tenant of tenants) {
        try {
          await this.discovery.discoverAllForAgent(tenant.id, {
            forceRefresh: true,
            skipModelsDevRefresh: true,
          });
          this.routingCache.invalidateTenant(tenant.id);
          refreshed++;
        } catch (err: unknown) {
          this.logger.warn(`Scheduled model refresh failed for tenant ${tenant.id}: ${err}`);
        }
      }
      this.logger.log(
        `Scheduled model catalog refresh: ${refreshed}/${tenants.length} tenant(s) updated`,
      );
      return refreshed;
    } catch (err: unknown) {
      this.logger.error(`Scheduled model catalog refresh failed: ${err}`);
      return 0;
    } finally {
      if (acquired) {
        try {
          await queryRunner.query(UNLOCK_SQL);
        } catch (err: unknown) {
          this.logger.warn(`Failed to release the catalog refresh lock: ${err}`);
        }
      }
      await queryRunner.release();
    }
  }
}
