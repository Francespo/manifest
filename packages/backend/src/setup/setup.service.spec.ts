import { ConflictException } from '@nestjs/common';

jest.mock('../auth/auth.instance', () => ({
  auth: {
    api: {
      signUpEmail: jest.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auth } = require('../auth/auth.instance');

import { SetupService } from './setup.service';

interface MockManager {
  query: jest.Mock;
}

function buildMockDataSource(managerQuery: jest.Mock) {
  const manager: MockManager = { query: managerQuery };
  return {
    query: jest.fn(),
    transaction: jest.fn(async (fn: (m: MockManager) => Promise<void>) => {
      await fn(manager);
    }),
  };
}

describe('SetupService', () => {
  let mockManagerQuery: jest.Mock;
  let ds: ReturnType<typeof buildMockDataSource>;
  let service: SetupService;

  beforeEach(() => {
    mockManagerQuery = jest.fn();
    ds = buildMockDataSource(mockManagerQuery);
    service = new SetupService(ds as never);
    jest.clearAllMocks();
  });

  describe('needsSetup', () => {
    it('returns true when user table is empty', async () => {
      ds.query.mockResolvedValueOnce([{ count: '0' }]);
      expect(await service.needsSetup()).toBe(true);
      expect(ds.query).toHaveBeenCalledWith(expect.stringContaining('COUNT(*)'));
    });

    it('returns false when at least one user exists', async () => {
      ds.query.mockResolvedValueOnce([{ count: '1' }]);
      expect(await service.needsSetup()).toBe(false);
    });

    it('handles multi-user count', async () => {
      ds.query.mockResolvedValueOnce([{ count: '42' }]);
      expect(await service.needsSetup()).toBe(false);
    });

    it('treats missing count row as empty', async () => {
      ds.query.mockResolvedValueOnce([]);
      expect(await service.needsSetup()).toBe(true);
    });
  });

  describe('createFirstAdmin', () => {
    const dto = { email: 'founder@example.com', name: 'Founder', password: 'secret-password' };

    it('acquires an advisory lock before checking user count', async () => {
      mockManagerQuery
        .mockResolvedValueOnce(undefined) // advisory lock
        .mockResolvedValueOnce([{ count: '0' }]) // count check
        .mockResolvedValueOnce(undefined); // emailVerified update
      (auth.api.signUpEmail as jest.Mock).mockResolvedValueOnce({});

      await service.createFirstAdmin(dto);

      expect(mockManagerQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
      expect(mockManagerQuery.mock.calls[1][0]).toContain('COUNT(*)');
    });

    it('calls Better Auth signUpEmail with the DTO', async () => {
      mockManagerQuery
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce(undefined);
      (auth.api.signUpEmail as jest.Mock).mockResolvedValueOnce({});

      await service.createFirstAdmin(dto);

      expect(auth.api.signUpEmail).toHaveBeenCalledWith({
        body: {
          email: 'founder@example.com',
          password: 'secret-password',
          name: 'Founder',
        },
      });
    });

    it('marks the new user as emailVerified', async () => {
      mockManagerQuery
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce(undefined);
      (auth.api.signUpEmail as jest.Mock).mockResolvedValueOnce({});

      await service.createFirstAdmin(dto);

      const lastCall = mockManagerQuery.mock.calls[mockManagerQuery.mock.calls.length - 1];
      expect(lastCall[0]).toContain('UPDATE "user"');
      expect(lastCall[0]).toContain('"emailVerified" = true');
      expect(lastCall[1]).toEqual(['founder@example.com']);
    });

    it('throws ConflictException when a user already exists', async () => {
      mockManagerQuery
        .mockResolvedValueOnce(undefined) // advisory lock
        .mockResolvedValueOnce([{ count: '1' }]); // count check

      await expect(service.createFirstAdmin(dto)).rejects.toThrow(ConflictException);
      expect(auth.api.signUpEmail).not.toHaveBeenCalled();
    });

    it('does not call signUpEmail when conflict is detected', async () => {
      mockManagerQuery.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: '3' }]);

      await expect(service.createFirstAdmin(dto)).rejects.toThrow('already completed');
      expect(auth.api.signUpEmail).not.toHaveBeenCalled();
    });

    it('wraps the whole operation in a transaction', async () => {
      mockManagerQuery
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce(undefined);
      (auth.api.signUpEmail as jest.Mock).mockResolvedValueOnce({});

      await service.createFirstAdmin(dto);

      expect(ds.transaction).toHaveBeenCalledTimes(1);
    });
  });
});
