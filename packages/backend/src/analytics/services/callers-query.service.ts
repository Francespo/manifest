import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentMessage } from '../../entities/agent-message.entity';
import { CallerAttribution } from '../../routing/proxy/caller-classifier';
import { rangeToInterval } from '../../common/utils/range.util';
import { computeCutoff } from '../../common/utils/sql-dialect';
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

interface RawMessage {
  caller_attribution: CallerAttribution | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cost_usd: number | string | null;
  timestamp: string;
}

@Injectable()
export class CallersQueryService {
  constructor(
    @InjectRepository(AgentMessage)
    private readonly messageRepo: Repository<AgentMessage>,
    private readonly tenantCache: TenantCacheService,
  ) {}

  async getCallers(range: string, userId: string, agentName?: string): Promise<CallersResponse> {
    const tenantId = (await this.tenantCache.resolve(userId)) ?? undefined;
    const cutoff = computeCutoff(rangeToInterval(range));

    const qb = this.messageRepo
      .createQueryBuilder('at')
      .select('at.caller_attribution', 'caller_attribution')
      .addSelect('at.input_tokens', 'input_tokens')
      .addSelect('at.output_tokens', 'output_tokens')
      .addSelect('at.cost_usd', 'cost_usd')
      .addSelect('at.timestamp', 'timestamp')
      .where('at.timestamp >= :cutoff', { cutoff });
    addTenantFilter(qb, userId, agentName, tenantId);

    const rows = (await qb.getRawMany()) as RawMessage[];

    const callerBuckets = new Map<string, CallerRow>();
    const sdkBuckets = new Map<string | null, SdkRow>();
    let total = 0;
    let attributed = 0;

    for (const row of rows) {
      total += 1;
      const attribution = parseAttribution(row.caller_attribution);
      const inTokens = toNumber(row.input_tokens);
      const outTokens = toNumber(row.output_tokens);
      const cost = Math.max(0, toNumber(row.cost_usd));
      const ts = row.timestamp;

      if (attribution) attributed += 1;

      const appName = attribution?.appName ?? null;
      const appUrl = attribution?.appUrl ?? null;
      const sdk = attribution?.sdk ?? null;
      const callerKey = `${appName ?? ''}\x00${appUrl ?? ''}\x00${sdk ?? ''}`;

      const existing = callerBuckets.get(callerKey);
      if (existing) {
        existing.message_count += 1;
        existing.input_tokens += inTokens;
        existing.output_tokens += outTokens;
        existing.cost_usd += cost;
        if (ts < existing.first_seen) existing.first_seen = ts;
        if (ts > existing.last_seen) existing.last_seen = ts;
      } else {
        callerBuckets.set(callerKey, {
          app_name: appName,
          app_url: appUrl,
          sdk,
          message_count: 1,
          input_tokens: inTokens,
          output_tokens: outTokens,
          cost_usd: cost,
          first_seen: ts,
          last_seen: ts,
        });
      }

      const sdkBucket = sdkBuckets.get(sdk);
      if (sdkBucket) {
        sdkBucket.message_count += 1;
        sdkBucket.cost_usd += cost;
      } else {
        sdkBuckets.set(sdk, { sdk, message_count: 1, cost_usd: cost });
      }
    }

    const callers = [...callerBuckets.values()].sort((a, b) => b.message_count - a.message_count);
    const sdks = [...sdkBuckets.values()].sort((a, b) => b.message_count - a.message_count);

    return {
      callers,
      sdks,
      total_messages: total,
      attributed_messages: attributed,
    };
  }
}

function parseAttribution(
  value: CallerAttribution | string | null | undefined,
): CallerAttribution | null {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as CallerAttribution;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Exposed for unit tests that exercise the internal helpers.
export const __testing = { parseAttribution, toNumber };
