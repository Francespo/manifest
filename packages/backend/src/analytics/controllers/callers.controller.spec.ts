import { Test, TestingModule } from '@nestjs/testing';
import { CallersController } from './callers.controller';
import { CallersQueryService } from '../services/callers-query.service';
import type { AuthUser } from '../../auth/auth.instance';

describe('CallersController', () => {
  let controller: CallersController;
  let service: { getCallers: jest.Mock };

  beforeEach(async () => {
    service = {
      getCallers: jest
        .fn()
        .mockResolvedValue({ callers: [], sdks: [], total_messages: 0, attributed_messages: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CallersController],
      providers: [{ provide: CallersQueryService, useValue: service }],
    }).compile();

    controller = module.get<CallersController>(CallersController);
  });

  const user = { id: 'user-1' } as AuthUser;

  it('defaults range to 24h when not provided', async () => {
    await controller.getCallers({}, user);
    expect(service.getCallers).toHaveBeenCalledWith('24h', 'user-1', undefined);
  });

  it('forwards range and agent_name to the service', async () => {
    await controller.getCallers({ range: '7d', agent_name: 'main' }, user);
    expect(service.getCallers).toHaveBeenCalledWith('7d', 'user-1', 'main');
  });

  it('returns whatever the service returns', async () => {
    const payload = {
      callers: [
        {
          sdk: 'curl',
          app_name: null,
          app_url: null,
          message_count: 1,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          first_seen: 't',
          last_seen: 't',
        },
      ],
      sdks: [{ sdk: 'curl', message_count: 1, cost_usd: 0 }],
      total_messages: 1,
      attributed_messages: 1,
    };
    service.getCallers.mockResolvedValue(payload);
    const result = await controller.getCallers({ range: '24h' }, user);
    expect(result).toBe(payload);
  });
});
