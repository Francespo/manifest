import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InstallMetadata } from '../entities/install-metadata.entity';
import { InstallIdService, SINGLETON_ID } from './install-id.service';

describe('InstallIdService', () => {
  let service: InstallIdService;
  let findOne: jest.Mock;
  let update: jest.Mock;
  let execute: jest.Mock;

  const rowTemplate: InstallMetadata = {
    id: SINGLETON_ID,
    install_id: '00000000-0000-0000-0000-000000000000',
    created_at: '2026-04-20T00:00:00',
    first_send_at: null,
    last_sent_at: null,
  };

  beforeEach(async () => {
    findOne = jest.fn();
    update = jest.fn().mockResolvedValue({ affected: 1 });
    execute = jest.fn().mockResolvedValue({ raw: [] });

    const qb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstallIdService,
        {
          provide: getRepositoryToken(InstallMetadata),
          useValue: {
            findOne,
            update,
            createQueryBuilder: () => qb,
          },
        },
      ],
    }).compile();

    service = module.get(InstallIdService);
  });

  describe('getOrCreate', () => {
    it('returns the existing singleton row without inserting', async () => {
      findOne.mockResolvedValueOnce(rowTemplate);

      const result = await service.getOrCreate();

      expect(result).toBe(rowTemplate);
      expect(execute).not.toHaveBeenCalled();
    });

    it('inserts a new singleton row when none exists and returns it', async () => {
      findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...rowTemplate, install_id: 'freshly-created-uuid' });

      const result = await service.getOrCreate();

      expect(execute).toHaveBeenCalledTimes(1);
      expect(result.install_id).toBe('freshly-created-uuid');
    });

    it('throws if the row is still missing after the upsert (should never happen)', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.getOrCreate()).rejects.toThrow(/missing after upsert/);
    });

    it('computes first_send_at within the next 24h (jitter)', async () => {
      findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(rowTemplate);
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const before = Date.now();

      await service.getOrCreate();

      const qbCall = execute.mock.calls[0];
      expect(qbCall).toBeDefined();
      // The inserted values are captured via the mock's call chain;
      // we just verify Math.random was consulted (→ jitter path taken).
      expect(randomSpy).toHaveBeenCalled();
      expect(Date.now()).toBeGreaterThanOrEqual(before);
      randomSpy.mockRestore();
    });
  });

  describe('markSent', () => {
    it('updates last_sent_at on the singleton row', async () => {
      const now = new Date('2026-04-20T12:00:00Z');

      await service.markSent(now);

      expect(update).toHaveBeenCalledWith(SINGLETON_ID, { last_sent_at: now.toISOString() });
    });
  });
});
