import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CallersQueryService, __testing } from './callers-query.service';
import { AgentMessage } from '../../entities/agent-message.entity';
import { TenantCacheService } from '../../common/services/tenant-cache.service';

function makeMockQb() {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ total: 0, attributed: 0 }),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
}

describe('CallersQueryService', () => {
  let service: CallersQueryService;
  let totalsQb: ReturnType<typeof makeMockQb>;
  let callersQb: ReturnType<typeof makeMockQb>;
  let sdksQb: ReturnType<typeof makeMockQb>;
  let createQueryBuilder: jest.Mock;
  let mockResolveTenant: jest.Mock;

  beforeEach(async () => {
    totalsQb = makeMockQb();
    callersQb = makeMockQb();
    sdksQb = makeMockQb();

    // The service calls buildBase() → createQueryBuilder() three times in order:
    // 1. totalsQb, 2. callersQb, 3. sdksQb.
    createQueryBuilder = jest
      .fn()
      .mockReturnValueOnce(totalsQb)
      .mockReturnValueOnce(callersQb)
      .mockReturnValueOnce(sdksQb);

    mockResolveTenant = jest.fn().mockResolvedValue('tenant-1');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallersQueryService,
        {
          provide: getRepositoryToken(AgentMessage),
          useValue: { createQueryBuilder },
        },
        { provide: DataSource, useValue: { options: { type: 'postgres' } } },
        {
          provide: TenantCacheService,
          useValue: { resolve: mockResolveTenant },
        },
      ],
    }).compile();

    service = module.get<CallersQueryService>(CallersQueryService);
  });

  it('maps SQL-aggregated rows into the response shape', async () => {
    totalsQb.getRawOne.mockResolvedValue({ total: '2', attributed: '2' });
    callersQb.getRawMany.mockResolvedValue([
      {
        app_name: 'OpenClaw',
        app_url: 'https://openclaw.ai',
        sdk: 'openai-js',
        message_count: '2',
        input_tokens: '300',
        output_tokens: '130',
        cost_usd: '0.03',
        first_seen: '2026-04-10T10:00:00',
        last_seen: '2026-04-10T11:00:00',
      },
    ]);
    sdksQb.getRawMany.mockResolvedValue([
      { sdk: 'openai-js', message_count: '2', cost_usd: '0.03' },
    ]);

    const result = await service.getCallers('24h', 'user-1');

    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]).toEqual({
      app_name: 'OpenClaw',
      app_url: 'https://openclaw.ai',
      sdk: 'openai-js',
      message_count: 2,
      input_tokens: 300,
      output_tokens: 130,
      cost_usd: 0.03,
      first_seen: '2026-04-10T10:00:00',
      last_seen: '2026-04-10T11:00:00',
    });
    expect(result.sdks).toEqual([{ sdk: 'openai-js', message_count: 2, cost_usd: 0.03 }]);
    expect(result.total_messages).toBe(2);
    expect(result.attributed_messages).toBe(2);
  });

  it('issues GROUP BY queries on JSON-extracted fields using the correct dialect', async () => {
    await service.getCallers('24h', 'user-1');

    // Callers query selects and groups on JSON-extracted fields
    const callerSelectCalls = [callersQb.select.mock.calls[0], ...callersQb.addSelect.mock.calls];
    const callerSelectText = callerSelectCalls.map((c) => c[0]).join(' ');
    expect(callerSelectText).toContain('appName');
    expect(callerSelectText).toContain('appUrl');
    expect(callerSelectText).toContain('sdk');

    expect(callersQb.groupBy).toHaveBeenCalledWith('app_name');
    expect(callersQb.addGroupBy).toHaveBeenCalledWith('app_url');
    expect(callersQb.addGroupBy).toHaveBeenCalledWith('sdk');
    expect(callersQb.orderBy).toHaveBeenCalledWith('message_count', 'DESC');

    // Totals query counts both total rows and attributed (non-NULL) rows
    expect(totalsQb.select).toHaveBeenCalledWith('COUNT(*)', 'total');
    expect(totalsQb.addSelect).toHaveBeenCalledWith('COUNT(at.caller_attribution)', 'attributed');
  });

  it('defaults totals and aggregates to zero when the DB returns nothing', async () => {
    totalsQb.getRawOne.mockResolvedValue(undefined);

    const result = await service.getCallers('24h', 'user-1');
    expect(result.total_messages).toBe(0);
    expect(result.attributed_messages).toBe(0);
    expect(result.callers).toHaveLength(0);
  });

  it('handles null cost in aggregated rows', async () => {
    callersQb.getRawMany.mockResolvedValue([
      {
        app_name: null,
        app_url: null,
        sdk: 'curl',
        message_count: '1',
        input_tokens: '0',
        output_tokens: '0',
        cost_usd: null,
        first_seen: 't',
        last_seen: 't',
      },
    ]);
    const result = await service.getCallers('24h', 'user-1');
    expect(result.callers[0].cost_usd).toBe(0);
  });

  it('resolves tenant via cache and applies agent_name filter when provided', async () => {
    await service.getCallers('7d', 'user-1', 'main');
    expect(mockResolveTenant).toHaveBeenCalledWith('user-1');
    // addTenantFilter() is called on each of the three query builders
    expect(totalsQb.andWhere).toHaveBeenCalledWith('at.agent_name = :agentName', {
      agentName: 'main',
    });
    expect(callersQb.andWhere).toHaveBeenCalledWith('at.agent_name = :agentName', {
      agentName: 'main',
    });
    expect(sdksQb.andWhere).toHaveBeenCalledWith('at.agent_name = :agentName', {
      agentName: 'main',
    });
  });

  it('falls back to userId filter when tenant cache returns null', async () => {
    mockResolveTenant.mockResolvedValue(null);
    await service.getCallers('24h', 'user-1');
    expect(totalsQb.andWhere).toHaveBeenCalledWith('at.user_id = :userId', { userId: 'user-1' });
  });
});

describe('CallersQueryService sqlite dialect', () => {
  it('uses json_extract syntax on sqlite', async () => {
    const totalsQb = makeMockQb();
    const callersQb = makeMockQb();
    const sdksQb = makeMockQb();
    const createQueryBuilder = jest
      .fn()
      .mockReturnValueOnce(totalsQb)
      .mockReturnValueOnce(callersQb)
      .mockReturnValueOnce(sdksQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallersQueryService,
        {
          provide: getRepositoryToken(AgentMessage),
          useValue: { createQueryBuilder },
        },
        { provide: DataSource, useValue: { options: { type: 'sqljs' } } },
        {
          provide: TenantCacheService,
          useValue: { resolve: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    const service = module.get<CallersQueryService>(CallersQueryService);
    await service.getCallers('24h', 'user-1');

    const callerSelectText = [
      callersQb.select.mock.calls[0]?.[0],
      ...callersQb.addSelect.mock.calls.map((c) => c[0]),
    ].join(' ');
    expect(callerSelectText).toContain("json_extract(at.caller_attribution, '$.appName')");
    expect(callerSelectText).toContain("json_extract(at.caller_attribution, '$.sdk')");
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
