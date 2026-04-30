import { QueryRunner } from 'typeorm';
import { AddModelRouteColumns1783000000000 } from './1783000000000-AddModelRouteColumns';

/**
 * Migration tests mock the QueryRunner and verify the SQL strings the
 * migration emits. Real DDL execution is covered by the boot-time migration
 * runner in production. We assert here that:
 *
 *   - the additive `up()` adds the expected columns and indexes,
 *   - the lossless override_route backfill builds the right jsonb shape,
 *   - the best-effort backfills are gated on unambiguous matches
 *     (HAVING COUNT/all_unambiguous), and
 *   - `down()` rolls back every column add and drops every index.
 */
describe('AddModelRouteColumns1783000000000', () => {
  let migration: AddModelRouteColumns1783000000000;
  let queryRunner: jest.Mocked<Pick<QueryRunner, 'query'>>;

  beforeEach(() => {
    migration = new AddModelRouteColumns1783000000000();
    queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
  });

  function ranSql(matcher: string | RegExp): boolean {
    return queryRunner.query.mock.calls.some(([sql]) => {
      if (typeof matcher === 'string') return sql.includes(matcher);
      return matcher.test(sql);
    });
  }

  describe('up — column adds', () => {
    it('adds override_route, auto_assigned_route, fallback_routes on tier_assignments', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      expect(ranSql('ALTER TABLE "tier_assignments" ADD COLUMN "override_route" jsonb')).toBe(true);
      expect(ranSql('ALTER TABLE "tier_assignments" ADD COLUMN "auto_assigned_route" jsonb')).toBe(
        true,
      );
      expect(ranSql('ALTER TABLE "tier_assignments" ADD COLUMN "fallback_routes" jsonb')).toBe(
        true,
      );
    });

    it('adds override_route, auto_assigned_route, fallback_routes on specificity_assignments', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      expect(
        ranSql('ALTER TABLE "specificity_assignments" ADD COLUMN "override_route" jsonb'),
      ).toBe(true);
      expect(
        ranSql('ALTER TABLE "specificity_assignments" ADD COLUMN "auto_assigned_route" jsonb'),
      ).toBe(true);
      expect(
        ranSql('ALTER TABLE "specificity_assignments" ADD COLUMN "fallback_routes" jsonb'),
      ).toBe(true);
    });

    it('adds override_route and fallback_routes on header_tiers (no auto_assigned)', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      expect(ranSql('ALTER TABLE "header_tiers" ADD COLUMN "override_route" jsonb')).toBe(true);
      expect(ranSql('ALTER TABLE "header_tiers" ADD COLUMN "fallback_routes" jsonb')).toBe(true);
      // Header tiers don't have an auto-assigned slot — they're always
      // user-configured. The migration must NOT add auto_assigned_route here.
      const headerAuto = queryRunner.query.mock.calls.some(
        ([sql]: [string, unknown[]?]) =>
          sql.includes('header_tiers') && sql.includes('auto_assigned_route'),
      );
      expect(headerAuto).toBe(false);
    });

    it('never drops legacy override columns (purely additive)', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      const dropLegacy = queryRunner.query.mock.calls.some(([sql]: [string, unknown[]?]) => {
        return /DROP COLUMN\s+"(override_model|override_provider|override_auth_type|auto_assigned_model|fallback_models)"/.test(
          sql,
        );
      });
      expect(dropLegacy).toBe(false);
    });
  });

  describe('up — backfill SQL', () => {
    it('builds override_route via jsonb_build_object from the legacy triple', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      // The override_route backfill must produce a jsonb with the three
      // canonical keys: provider, authType, model. This shape is what
      // readOverrideRoute() reads back.
      expect(
        queryRunner.query.mock.calls.some(([sql]: [string, unknown[]?]) =>
          /jsonb_build_object[\s\S]*'provider'[\s\S]*'authType'[\s\S]*'model'/.test(sql),
        ),
      ).toBe(true);
    });

    it('only writes override_route when all three legacy fields are present', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      // The WHERE clause must guard the backfill against partial rows so we
      // never persist a route with a null field.
      expect(
        queryRunner.query.mock.calls.some(
          ([sql]: [string, unknown[]?]) =>
            sql.includes('"override_model" IS NOT NULL') &&
            sql.includes('"override_provider" IS NOT NULL') &&
            sql.includes('"override_auth_type" IS NOT NULL'),
        ),
      ).toBe(true);
    });

    it('gates auto_assigned_route backfill on a single unambiguous (provider, auth_type) match', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      // The match_count = 1 filter on COUNT(*) OVER (PARTITION BY t2.id) is
      // what guarantees we only set auto_assigned_route when exactly one
      // user_provider offers the model. Postgres disallows window functions
      // in HAVING, so the filter lives in an outer SELECT/UPDATE WHERE.
      expect(
        queryRunner.query.mock.calls.some(
          ([sql]: [string, unknown[]?]) =>
            sql.includes('auto_assigned_route') &&
            /COUNT\(\*\)\s+OVER\s*\(\s*PARTITION BY\s+t2\.id\s*\)/.test(sql) &&
            /match_count\s*=\s*1/.test(sql),
        ),
      ).toBe(true);
    });

    it('only attempts auto_assigned_route backfill on tier and specificity assignments', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      // header_tiers is intentionally excluded — the column doesn't exist.
      const headerAuto = queryRunner.query.mock.calls.some(
        ([sql]: [string, unknown[]?]) =>
          sql.includes('"header_tiers"') && sql.includes('auto_assigned_route'),
      );
      expect(headerAuto).toBe(false);

      const tierAuto = queryRunner.query.mock.calls.some(
        ([sql]: [string, unknown[]?]) =>
          sql.includes('"tier_assignments"') && sql.includes('auto_assigned_route'),
      );
      expect(tierAuto).toBe(true);

      const specAuto = queryRunner.query.mock.calls.some(
        ([sql]: [string, unknown[]?]) =>
          sql.includes('"specificity_assignments"') && sql.includes('auto_assigned_route'),
      );
      expect(specAuto).toBe(true);
    });

    it('only writes fallback_routes when EVERY entry resolves unambiguously', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      // bool_and(...) over the resolved.unambiguous flag, joined back through
      // the aggregated CTE's all_unambiguous, ensures we leave fallback_routes
      // null when any single fallback model is ambiguous.
      expect(
        queryRunner.query.mock.calls.some(
          ([sql]: [string, unknown[]?]) =>
            sql.includes('fallback_routes') && /bool_and\(\s*r\.unambiguous\s*\)/.test(sql),
        ),
      ).toBe(true);
      expect(
        queryRunner.query.mock.calls.some(
          ([sql]: [string, unknown[]?]) =>
            sql.includes('fallback_routes') && /a\.all_unambiguous\s*=\s*true/.test(sql),
        ),
      ).toBe(true);
    });

    it('preserves fallback order via WITH ORDINALITY', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      // Without ORDINALITY the backfilled fallback_routes wouldn't line up
      // with the legacy fallback_models string[] — that would break the
      // proxy's "tries fallbacks in order" invariant. The ORDER BY r.idx in
      // jsonb_agg threads the ordinal through the resolved CTE.
      expect(
        queryRunner.query.mock.calls.some(
          ([sql]: [string, unknown[]?]) =>
            sql.includes('fallback_routes') &&
            /WITH ORDINALITY/.test(sql) &&
            /ORDER BY\s+r\.idx/.test(sql),
        ),
      ).toBe(true);
    });
  });

  describe('up — indexes', () => {
    it('creates GIN indexes on every route column for cleanup queries', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      const expected = [
        'idx_tier_assignments_override_route',
        'idx_tier_assignments_fallback_routes',
        'idx_specificity_assignments_override_route',
        'idx_specificity_assignments_fallback_routes',
        'idx_header_tiers_override_route',
        'idx_header_tiers_fallback_routes',
      ];
      for (const idx of expected) {
        expect(
          queryRunner.query.mock.calls.some(
            ([sql]: [string, unknown[]?]) =>
              sql.includes(idx) && sql.includes('CREATE INDEX') && sql.includes('USING GIN'),
          ),
        ).toBe(true);
      }
    });

    it('creates indexes idempotently with IF NOT EXISTS', async () => {
      await migration.up(queryRunner as unknown as QueryRunner);

      // Migrations re-run after partial failure shouldn't choke on existing
      // indexes; IF NOT EXISTS is the simplest guarantee.
      const indexCalls = queryRunner.query.mock.calls.filter(([sql]: [string, unknown[]?]) =>
        sql.includes('CREATE INDEX'),
      );
      expect(indexCalls.length).toBeGreaterThan(0);
      for (const [sql] of indexCalls) {
        expect(sql).toMatch(/IF NOT EXISTS/);
      }
    });
  });

  describe('down', () => {
    it('drops every route column on every table', async () => {
      await migration.down(queryRunner as unknown as QueryRunner);

      const drops = [
        ['tier_assignments', 'fallback_routes'],
        ['tier_assignments', 'auto_assigned_route'],
        ['tier_assignments', 'override_route'],
        ['specificity_assignments', 'fallback_routes'],
        ['specificity_assignments', 'auto_assigned_route'],
        ['specificity_assignments', 'override_route'],
        ['header_tiers', 'fallback_routes'],
        ['header_tiers', 'override_route'],
      ];
      for (const [table, col] of drops) {
        expect(
          queryRunner.query.mock.calls.some(
            ([sql]: [string, unknown[]?]) =>
              sql.includes(`"${table}"`) && sql.includes(`DROP COLUMN "${col}"`),
          ),
        ).toBe(true);
      }
    });

    it('drops every GIN index that up() created', async () => {
      await migration.down(queryRunner as unknown as QueryRunner);

      const indexes = [
        'idx_tier_assignments_override_route',
        'idx_tier_assignments_fallback_routes',
        'idx_specificity_assignments_override_route',
        'idx_specificity_assignments_fallback_routes',
        'idx_header_tiers_override_route',
        'idx_header_tiers_fallback_routes',
      ];
      for (const idx of indexes) {
        expect(
          queryRunner.query.mock.calls.some(
            ([sql]: [string, unknown[]?]) => sql.includes(`DROP INDEX`) && sql.includes(idx),
          ),
        ).toBe(true);
      }
    });

    it('does not touch any legacy column on the way down', async () => {
      await migration.down(queryRunner as unknown as QueryRunner);

      const touchedLegacy = queryRunner.query.mock.calls.some(([sql]: [string, unknown[]?]) =>
        /DROP COLUMN\s+"(override_model|override_provider|override_auth_type|auto_assigned_model|fallback_models)"/.test(
          sql,
        ),
      );
      expect(touchedLegacy).toBe(false);
    });
  });
});
