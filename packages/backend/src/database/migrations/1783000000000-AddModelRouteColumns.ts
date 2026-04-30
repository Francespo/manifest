import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add jsonb route columns alongside the existing legacy columns on
 * tier_assignments, specificity_assignments, header_tiers. Backfill
 * losslessly where the (model, provider, auth_type) triple is fully
 * present; best-effort backfill for auto_assigned and fallbacks via
 * a join against user_providers.cached_models for unambiguous matches.
 *
 * No legacy columns are dropped here — this migration is purely additive.
 * A follow-up release will drop the legacy columns once the dual-write
 * cycle has soaked.
 */
export class AddModelRouteColumns1783000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add columns -------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "tier_assignments" ADD COLUMN "override_route" jsonb DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tier_assignments" ADD COLUMN "auto_assigned_route" jsonb DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tier_assignments" ADD COLUMN "fallback_routes" jsonb DEFAULT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "specificity_assignments" ADD COLUMN "override_route" jsonb DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "specificity_assignments" ADD COLUMN "auto_assigned_route" jsonb DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "specificity_assignments" ADD COLUMN "fallback_routes" jsonb DEFAULT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "header_tiers" ADD COLUMN "override_route" jsonb DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "header_tiers" ADD COLUMN "fallback_routes" jsonb DEFAULT NULL`,
    );

    // 2. Lossless override_route backfill ---------------------------------
    // Where the legacy triple is fully present, the route is unambiguous.
    for (const table of ['tier_assignments', 'specificity_assignments', 'header_tiers']) {
      await queryRunner.query(`
        UPDATE "${table}"
        SET "override_route" = jsonb_build_object(
          'provider', "override_provider",
          'authType', "override_auth_type",
          'model', "override_model"
        )
        WHERE "override_model" IS NOT NULL
          AND "override_provider" IS NOT NULL
          AND "override_auth_type" IS NOT NULL
          AND "override_route" IS NULL
      `);
    }

    // 3. Best-effort auto_assigned_route backfill -------------------------
    // For tier_assignments and specificity_assignments only. Looks up
    // user_providers.cached_models by model name and only succeeds when
    // exactly one (provider, auth_type) pair matches. Ambiguous rows stay
    // null and are repopulated on next provider mutation by
    // TierAutoAssignService.recalculate().
    for (const table of ['tier_assignments', 'specificity_assignments']) {
      await queryRunner.query(`
        UPDATE "${table}" t
        SET "auto_assigned_route" = subq.route
        FROM (
          SELECT
            t2.id AS row_id,
            jsonb_build_object(
              'provider', up.provider,
              'authType', up.auth_type,
              'model', t2.auto_assigned_model
            ) AS route
          FROM "${table}" t2
          JOIN "user_providers" up ON up.agent_id = t2.agent_id AND up.is_active = true
          WHERE t2.auto_assigned_model IS NOT NULL
            AND t2.auto_assigned_route IS NULL
            AND up.cached_models IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(up.cached_models) m
              WHERE m->>'id' = t2.auto_assigned_model
            )
          GROUP BY t2.id, up.provider, up.auth_type, t2.auto_assigned_model
          HAVING COUNT(*) OVER (PARTITION BY t2.id) = 1
        ) subq
        WHERE t.id = subq.row_id
      `);
    }

    // 4. Best-effort fallback_routes backfill ------------------------------
    // For each fallback model name in the legacy string[], try to resolve
    // it to exactly one (provider, auth_type) via cached_models. Models that
    // resolve unambiguously are written into fallback_routes preserving order;
    // ambiguous fallbacks fall back to inferring at proxy-time from the legacy
    // fallback_models column (existing behavior, unchanged).
    //
    // We do this in a single pass per row using a CTE that aggregates per
    // fallback name. Rows where every fallback resolves get a complete
    // fallback_routes; rows with any ambiguous fallback leave fallback_routes
    // null so the existing legacy path stays authoritative.
    for (const table of ['tier_assignments', 'specificity_assignments', 'header_tiers']) {
      await queryRunner.query(`
        UPDATE "${table}" t
        SET "fallback_routes" = subq.routes
        FROM (
          SELECT
            t2.id AS row_id,
            jsonb_agg(
              jsonb_build_object(
                'provider', resolved.provider,
                'authType', resolved.auth_type,
                'model', resolved.model_name
              )
              ORDER BY resolved.idx
            ) AS routes,
            bool_and(resolved.unambiguous) AS all_unambiguous
          FROM "${table}" t2
          CROSS JOIN LATERAL (
            SELECT
              fm.value::text AS model_name,
              fm.ordinality AS idx,
              (
                SELECT up.provider
                FROM "user_providers" up
                WHERE up.agent_id = t2.agent_id
                  AND up.is_active = true
                  AND up.cached_models IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(up.cached_models) m
                    WHERE m->>'id' = trim(both '"' from fm.value::text)
                  )
                LIMIT 1
              ) AS provider,
              (
                SELECT up.auth_type
                FROM "user_providers" up
                WHERE up.agent_id = t2.agent_id
                  AND up.is_active = true
                  AND up.cached_models IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(up.cached_models) m
                    WHERE m->>'id' = trim(both '"' from fm.value::text)
                  )
                LIMIT 1
              ) AS auth_type,
              (
                SELECT COUNT(*) = 1
                FROM "user_providers" up
                WHERE up.agent_id = t2.agent_id
                  AND up.is_active = true
                  AND up.cached_models IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(up.cached_models) m
                    WHERE m->>'id' = trim(both '"' from fm.value::text)
                  )
              ) AS unambiguous
          ) resolved
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(t2.fallback_models::jsonb) = 'array'
                THEN t2.fallback_models::jsonb
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS fm(value, ordinality)
          WHERE t2.fallback_models IS NOT NULL
            AND t2.fallback_routes IS NULL
            AND jsonb_typeof(t2.fallback_models::jsonb) = 'array'
            AND jsonb_array_length(t2.fallback_models::jsonb) > 0
          GROUP BY t2.id
        ) subq
        WHERE t.id = subq.row_id
          AND subq.all_unambiguous = true
      `);
    }

    // 5. Helpful indexes for cleanup queries ------------------------------
    // GIN indexes on the route columns let RoutingInvalidationService scan
    // by provider efficiently when a provider is disconnected.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tier_assignments_override_route" ON "tier_assignments" USING GIN ("override_route")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tier_assignments_fallback_routes" ON "tier_assignments" USING GIN ("fallback_routes")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_specificity_assignments_override_route" ON "specificity_assignments" USING GIN ("override_route")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_specificity_assignments_fallback_routes" ON "specificity_assignments" USING GIN ("fallback_routes")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_header_tiers_override_route" ON "header_tiers" USING GIN ("override_route")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_header_tiers_fallback_routes" ON "header_tiers" USING GIN ("fallback_routes")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_header_tiers_fallback_routes"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_header_tiers_override_route"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_specificity_assignments_fallback_routes"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_specificity_assignments_override_route"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tier_assignments_fallback_routes"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tier_assignments_override_route"`);

    await queryRunner.query(`ALTER TABLE "header_tiers" DROP COLUMN "fallback_routes"`);
    await queryRunner.query(`ALTER TABLE "header_tiers" DROP COLUMN "override_route"`);

    await queryRunner.query(`ALTER TABLE "specificity_assignments" DROP COLUMN "fallback_routes"`);
    await queryRunner.query(
      `ALTER TABLE "specificity_assignments" DROP COLUMN "auto_assigned_route"`,
    );
    await queryRunner.query(`ALTER TABLE "specificity_assignments" DROP COLUMN "override_route"`);

    await queryRunner.query(`ALTER TABLE "tier_assignments" DROP COLUMN "fallback_routes"`);
    await queryRunner.query(`ALTER TABLE "tier_assignments" DROP COLUMN "auto_assigned_route"`);
    await queryRunner.query(`ALTER TABLE "tier_assignments" DROP COLUMN "override_route"`);
  }
}
