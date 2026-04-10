import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgentMessage } from '../../entities/agent-message.entity';
import { rangeToInterval } from '../../common/utils/range.util';
import {
  DbDialect,
  detectDialect,
  computeCutoff,
  sqlJsonField,
  sqlSanitizeCost,
} from '../../common/utils/sql-dialect';
import { addTenantFilter } from './query-helpers';
import { TenantCacheService } from '../../common/services/tenant-cache.service';

export interface CallerRow {
  app_name: string | null;
  app_url: string | null;
  sdk: string | null;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  first_seen: string;
  last_seen: string;
}

export interface SdkRow {
  sdk: string | null;
  message_count: number;
  cost_usd: number;
}

export interface CallersResponse {
  callers: CallerRow[];
  sdks: SdkRow[];
  total_messages: number;
  attributed_messages: number;
}

interface RawCallerRow {
  app_name: string | null;
  app_url: string | null;
  sdk: string | null;
  message_count: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  cost_usd: number | string | null;
  first_seen: string;
  last_seen: string;
}

interface RawSdkRow {
  sdk: string | null;
  message_count: number | string;
  cost_usd: number | string | null;
}

interface RawTotalsRow {
  total: number | string | null;
  attributed: number | string | null;
}

@Injectable()
export class CallersQueryService {
  private readonly dialect: DbDialect;

  constructor(
    @InjectRepository(AgentMessage)
    private readonly messageRepo: Repository<AgentMessage>,
    private readonly dataSource: DataSource,
    private readonly tenantCache: TenantCacheService,
  ) {
    this.dialect = detectDialect(this.dataSource.options.type as string);
  }

  async getCallers(range: string, userId: string, agentName?: string): Promise<CallersResponse> {
    const tenantId = (await this.tenantCache.resolve(userId)) ?? undefined;
    const cutoff = computeCutoff(rangeToInterval(range));

    const appNameExpr = sqlJsonField('at.caller_attribution', 'appName', this.dialect);
    const appUrlExpr = sqlJsonField('at.caller_attribution', 'appUrl', this.dialect);
    const sdkExpr = sqlJsonField('at.caller_attribution', 'sdk', this.dialect);
    const safeCost = sqlSanitizeCost('at.cost_usd');

    const buildBase = () => {
      const qb = this.messageRepo
        .createQueryBuilder('at')
        .where('at.timestamp >= :cutoff', { cutoff });
      addTenantFilter(qb, userId, agentName, tenantId);
      return qb;
    };

    // COUNT(col) counts non-NULL values, so this gives us the attributed count.
    const totalsQb = buildBase()
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(at.caller_attribution)', 'attributed');

    const callersQb = buildBase()
      .select(appNameExpr, 'app_name')
      .addSelect(appUrlExpr, 'app_url')
      .addSelect(sdkExpr, 'sdk')
      .addSelect('COUNT(*)', 'message_count')
      .addSelect('COALESCE(SUM(at.input_tokens), 0)', 'input_tokens')
      .addSelect('COALESCE(SUM(at.output_tokens), 0)', 'output_tokens')
      .addSelect(`COALESCE(SUM(${safeCost}), 0)`, 'cost_usd')
      .addSelect('MIN(at.timestamp)', 'first_seen')
      .addSelect('MAX(at.timestamp)', 'last_seen')
      .groupBy('app_name')
      .addGroupBy('app_url')
      .addGroupBy('sdk')
      .orderBy('message_count', 'DESC');

    const sdksQb = buildBase()
      .select(sdkExpr, 'sdk')
      .addSelect('COUNT(*)', 'message_count')
      .addSelect(`COALESCE(SUM(${safeCost}), 0)`, 'cost_usd')
      .groupBy('sdk')
      .orderBy('message_count', 'DESC');

    const [totalsRow, callerRows, sdkRows] = await Promise.all([
      totalsQb.getRawOne() as Promise<RawTotalsRow | undefined>,
      callersQb.getRawMany() as Promise<RawCallerRow[]>,
      sdksQb.getRawMany() as Promise<RawSdkRow[]>,
    ]);

    return {
      callers: callerRows.map((row) => ({
        app_name: row.app_name,
        app_url: row.app_url,
        sdk: row.sdk,
        message_count: toNumber(row.message_count),
        input_tokens: toNumber(row.input_tokens),
        output_tokens: toNumber(row.output_tokens),
        cost_usd: toNumber(row.cost_usd),
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      })),
      sdks: sdkRows.map((row) => ({
        sdk: row.sdk,
        message_count: toNumber(row.message_count),
        cost_usd: toNumber(row.cost_usd),
      })),
      total_messages: toNumber(totalsRow?.total),
      attributed_messages: toNumber(totalsRow?.attributed),
    };
  }
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Exposed for unit tests that exercise the internal helper.
export const __testing = { toNumber };
