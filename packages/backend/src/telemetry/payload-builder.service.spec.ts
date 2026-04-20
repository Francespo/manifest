import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Agent } from '../entities/agent.entity';
import { AgentMessage } from '../entities/agent-message.entity';
import { PayloadBuilderService } from './payload-builder.service';

function mockQueryBuilder(
  providerRows: Array<{ provider: string | null; count: string }>,
  totals: { total: string; input_tokens: string | null; output_tokens: string | null },
) {
  const groupByQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(providerRows),
    getRawOne: jest.fn(),
  };
  const totalsQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(totals),
  };
  let call = 0;
  return {
    createQueryBuilder: jest.fn(() => {
      call++;
      return call === 1 ? groupByQb : totalsQb;
    }),
  };
}

describe('PayloadBuilderService', () => {
  async function makeService(
    providerRows: Array<{ provider: string | null; count: string }>,
    totals: { total: string; input_tokens: string | null; output_tokens: string | null } | null,
    agentsCount: number,
  ): Promise<PayloadBuilderService> {
    const messagesRepo = mockQueryBuilder(
      providerRows,
      totals ?? { total: '0', input_tokens: '0', output_tokens: '0' },
    );
    if (totals === null) {
      // Force the null-branch in `totals()` via a custom query-builder factory
      (messagesRepo.createQueryBuilder as jest.Mock).mockImplementation(() => {
        const qb = {
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue(providerRows),
          getRawOne: jest.fn().mockResolvedValue(undefined),
        };
        return qb;
      });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayloadBuilderService,
        { provide: getRepositoryToken(AgentMessage), useValue: messagesRepo },
        {
          provide: getRepositoryToken(Agent),
          useValue: { count: jest.fn().mockResolvedValue(agentsCount) },
        },
      ],
    }).compile();

    return module.get(PayloadBuilderService);
  }

  it('builds a payload with schema_version + install_id + manifest_version', async () => {
    const service = await makeService(
      [{ provider: 'anthropic', count: '3' }],
      { total: '3', input_tokens: '100', output_tokens: '50' },
      2,
    );

    const payload = await service.build('inst-123', '5.47.0');

    expect(payload.schema_version).toBe(1);
    expect(payload.install_id).toBe('inst-123');
    expect(payload.manifest_version).toBe('5.47.0');
  });

  it('aggregates message counts and token totals across the 24h window', async () => {
    const service = await makeService(
      [
        { provider: 'anthropic', count: '10' },
        { provider: 'openai', count: '5' },
      ],
      { total: '15', input_tokens: '1200', output_tokens: '800' },
      4,
    );

    const payload = await service.build('inst', '1.0.0');

    expect(payload.messages_total).toBe(15);
    expect(payload.tokens_input_total).toBe(1200);
    expect(payload.tokens_output_total).toBe(800);
    expect(payload.agents_total).toBe(4);
    expect(payload.messages_by_provider).toEqual({ anthropic: 10, openai: 5 });
  });

  it('collapses unknown provider names to "custom" to prevent leakage', async () => {
    const service = await makeService(
      [
        { provider: 'anthropic', count: '2' },
        { provider: 'my-self-hosted-vllm', count: '4' },
        { provider: 'another-custom', count: '1' },
      ],
      { total: '7', input_tokens: '0', output_tokens: '0' },
      1,
    );

    const payload = await service.build('inst', '1.0.0');

    expect(payload.messages_by_provider).toEqual({ anthropic: 2, custom: 5 });
  });

  it('maps NULL providers to an "unknown" bucket', async () => {
    const service = await makeService(
      [{ provider: null, count: '2' }],
      { total: '2', input_tokens: '0', output_tokens: '0' },
      0,
    );

    const payload = await service.build('inst', '1.0.0');

    expect(payload.messages_by_provider).toEqual({ unknown: 2 });
  });

  it('respects provider registry aliases (e.g. "google" → "gemini")', async () => {
    const service = await makeService(
      [{ provider: 'google', count: '3' }],
      { total: '3', input_tokens: '0', output_tokens: '0' },
      0,
    );

    const payload = await service.build('inst', '1.0.0');

    expect(Object.keys(payload.messages_by_provider)).toContain('gemini');
  });

  it('treats missing token sums as zero', async () => {
    const service = await makeService(
      [],
      { total: '0', input_tokens: null, output_tokens: null },
      0,
    );

    const payload = await service.build('inst', '1.0.0');

    expect(payload.tokens_input_total).toBe(0);
    expect(payload.tokens_output_total).toBe(0);
    expect(payload.messages_total).toBe(0);
  });

  it('defaults totals to zero when the query returns undefined', async () => {
    const service = await makeService([], null, 0);

    const payload = await service.build('inst', '1.0.0');

    expect(payload.messages_total).toBe(0);
    expect(payload.tokens_input_total).toBe(0);
    expect(payload.tokens_output_total).toBe(0);
  });
});
