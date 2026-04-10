import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CallersQueryService, __testing } from './callers-query.service';
import { AgentMessage } from '../../entities/agent-message.entity';
import { TenantCacheService } from '../../common/services/tenant-cache.service';

describe('CallersQueryService', () => {
  let service: CallersQueryService;
  let mockGetRawMany: jest.Mock;
  let mockWhere: jest.Mock;
  let mockAndWhere: jest.Mock;
  let mockResolveTenant: jest.Mock;

  beforeEach(async () => {
    mockGetRawMany = jest.fn().mockResolvedValue([]);
    mockWhere = jest.fn().mockReturnThis();
    mockAndWhere = jest.fn().mockReturnThis();
    mockResolveTenant = jest.fn().mockResolvedValue('tenant-1');

    const mockQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: mockWhere,
      andWhere: mockAndWhere,
      getRawMany: mockGetRawMany,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallersQueryService,
        {
          provide: getRepositoryToken(AgentMessage),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(mockQb) },
        },
        {
          provide: TenantCacheService,
          useValue: { resolve: mockResolveTenant },
        },
      ],
    }).compile();

    service = module.get<CallersQueryService>(CallersQueryService);
  });

  it('groups identical callers across rows and aggregates tokens + cost', async () => {
    const t1 = '2026-04-10T10:00:00';
    const t2 = '2026-04-10T11:00:00';
    mockGetRawMany.mockResolvedValue([
      {
        caller_attribution: {
          sdk: 'openai-js',
          appName: 'OpenClaw',
          appUrl: 'https://openclaw.ai',
        },
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: '0.01',
        timestamp: t1,
      },
      {
        caller_attribution: {
          sdk: 'openai-js',
          appName: 'OpenClaw',
          appUrl: 'https://openclaw.ai',
        },
        input_tokens: 200,
        output_tokens: 80,
        cost_usd: 0.02,
        timestamp: t2,
      },
    ]);

    const result = await service.getCallers('24h', 'user-1');

    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]).toMatchObject({
      app_name: 'OpenClaw',
      app_url: 'https://openclaw.ai',
      sdk: 'openai-js',
      message_count: 2,
      input_tokens: 300,
      output_tokens: 130,
      first_seen: t1,
      last_seen: t2,
    });
    expect(result.callers[0].cost_usd).toBeCloseTo(0.03, 6);
    expect(result.total_messages).toBe(2);
    expect(result.attributed_messages).toBe(2);
  });

  it('sorts callers and sdks by message count descending', async () => {
    mockGetRawMany.mockResolvedValue([
      {
        caller_attribution: { sdk: 'curl' },
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        timestamp: '2026-04-10T10:00:00',
      },
      {
        caller_attribution: { sdk: 'openai-js' },
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        timestamp: '2026-04-10T10:00:00',
      },
      {
        caller_attribution: { sdk: 'openai-js' },
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        timestamp: '2026-04-10T10:00:00',
      },
    ]);

    const result = await service.getCallers('24h', 'user-1');

    expect(result.callers[0].sdk).toBe('openai-js');
    expect(result.sdks[0].sdk).toBe('openai-js');
    expect(result.sdks[0].message_count).toBe(2);
  });

  it('treats unattributed rows as a null-sdk bucket and counts them separately from attributed', async () => {
    mockGetRawMany.mockResolvedValue([
      {
        caller_attribution: null,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: null,
        timestamp: '2026-04-10T10:00:00',
      },
      {
        caller_attribution: { sdk: 'curl' },
        input_tokens: 10,
        output_tokens: 5,
        cost_usd: 0.001,
        timestamp: '2026-04-10T10:00:00',
      },
    ]);

    const result = await service.getCallers('24h', 'user-1');

    expect(result.total_messages).toBe(2);
    expect(result.attributed_messages).toBe(1);
    const nullBucket = result.callers.find((c) => c.sdk === null);
    expect(nullBucket).toBeDefined();
    expect(nullBucket?.app_name).toBeNull();
    expect(result.sdks.some((s) => s.sdk === null)).toBe(true);
  });

  it('ignores negative cost values in aggregation', async () => {
    mockGetRawMany.mockResolvedValue([
      {
        caller_attribution: { sdk: 'curl' },
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: -1.5,
        timestamp: '2026-04-10T10:00:00',
      },
    ]);

    const result = await service.getCallers('24h', 'user-1');
    expect(result.callers[0].cost_usd).toBe(0);
  });

  it('resolves tenant via cache and applies agent_name filter when provided', async () => {
    await service.getCallers('7d', 'user-1', 'main');
    expect(mockResolveTenant).toHaveBeenCalledWith('user-1');
    expect(mockAndWhere).toHaveBeenCalledWith('at.agent_name = :agentName', { agentName: 'main' });
  });

  it('updates first_seen when a later-arriving row has an earlier timestamp', async () => {
    const earlier = '2026-04-10T08:00:00';
    const later = '2026-04-10T12:00:00';
    mockGetRawMany.mockResolvedValue([
      {
        caller_attribution: { sdk: 'curl' },
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        timestamp: later,
      },
      {
        caller_attribution: { sdk: 'curl' },
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        timestamp: earlier,
      },
    ]);
    const result = await service.getCallers('24h', 'user-1');
    expect(result.callers[0].first_seen).toBe(earlier);
    expect(result.callers[0].last_seen).toBe(later);
  });

  it('handles tenant cache returning null (falls back to userId filter)', async () => {
    mockResolveTenant.mockResolvedValue(null);
    await service.getCallers('24h', 'user-1');
    expect(mockAndWhere).toHaveBeenCalledWith('at.user_id = :userId', { userId: 'user-1' });
  });
});

describe('parseAttribution', () => {
  const { parseAttribution } = __testing;

  it('returns null for null and undefined', () => {
    expect(parseAttribution(null)).toBeNull();
    expect(parseAttribution(undefined)).toBeNull();
  });

  it('returns the object verbatim when already an object', () => {
    const obj = { sdk: 'curl' };
    expect(parseAttribution(obj)).toBe(obj);
  });

  it('parses valid JSON strings', () => {
    expect(parseAttribution('{"sdk":"curl"}')).toEqual({ sdk: 'curl' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseAttribution('not json')).toBeNull();
  });

  it('returns null for JSON that parses to a non-object', () => {
    expect(parseAttribution('"scalar"')).toBeNull();
    expect(parseAttribution('null')).toBeNull();
  });
});

describe('toNumber', () => {
  const { toNumber } = __testing;

  it('returns 0 for null/undefined', () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });

  it('passes numbers through', () => {
    expect(toNumber(42)).toBe(42);
  });

  it('parses numeric strings', () => {
    expect(toNumber('3.14')).toBe(3.14);
  });

  it('returns 0 for non-numeric strings', () => {
    expect(toNumber('abc')).toBe(0);
  });
});
