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

interface MockQueryRunner {
  connect: jest.Mock;
  release: jest.Mock;
  query: jest.Mock;
}

function buildMockDataSource(runnerQuery: jest.Mock) {
  const queryRunner: MockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: runnerQuery,
  };
  return {
    query: jest.fn(),
    createQueryRunner: jest.fn(() => queryRunner),
    _queryRunner: queryRunner,
  };
}

describe('SetupService', () => {
  let runnerQuery: jest.Mock;
  let ds: ReturnType<typeof buildMockDataSource>;
  let service: SetupService;

  beforeEach(() => {
    runnerQuery = jest.fn();
    ds = buildMockDataSource(runnerQuery);
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

    function mockHappyPath(): void {
      runnerQuery
        .mockResolvedValueOnce(undefined) // pg_advisory_lock
        .mockResolvedValueOnce([{ count: '0' }]) // count check
        .mockResolvedValueOnce(undefined) // UPDATE emailVerified
        .mockResolvedValueOnce(undefined); // pg_advisory_unlock
    }

    it('acquires and releases a session-level advisory lock around the flow', async () => {
      mockHappyPath();
      (auth.api.signUpEmail as jest.Mock).mockResolvedValueOnce({});

      await service.createFirstAdmin(dto);

      const lockCall = runnerQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_lock'),
      );
      const unlockCall = runnerQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock'),
      );
      expect(lockCall).toBeDefined();
      expect(unlockCall).toBeDefined();
      expect(ds._queryRunner.connect).toHaveBeenCalledTimes(1);
      expect(ds._queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('calls Better Auth signUpEmail with the DTO', async () => {
      mockHappyPath();
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
      mockHappyPath();
      (auth.api.signUpEmail as jest.Mock).mockResolvedValueOnce({});

      await service.createFirstAdmin(dto);

      const updateCall = runnerQuery.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('UPDATE "user"') &&
          c[0].includes('emailVerified'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toEqual(['founder@example.com']);
    });

    it('throws ConflictException when a user already exists and is verified', async () => {
      runnerQuery
        .mockResolvedValueOnce(undefined) // lock
        .mockResolvedValueOnce([{ count: '1' }]) // count
        .mockResolvedValueOnce([]) // unverified check returns none
        .mockResolvedValueOnce(undefined); // unlock

      await expect(service.createFirstAdmin(dto)).rejects.toThrow(ConflictException);
      expect(auth.api.signUpEmail).not.toHaveBeenCalled();
    });

    it('throws ConflictException when multiple users already exist', async () => {
      runnerQuery
        .mockResolvedValueOnce(undefined) // lock
        .mockResolvedValueOnce([{ count: '3' }]) // count
        .mockResolvedValueOnce(undefined); // unlock

      await expect(service.createFirstAdmin(dto)).rejects.toThrow('already completed');
      expect(auth.api.signUpEmail).not.toHaveBeenCalled();
    });

    it('releases the advisory lock even when the flow throws', async () => {
      runnerQuery
        .mockResolvedValueOnce(undefined) // lock
        .mockResolvedValueOnce([{ count: '5' }]) // count — triggers 409
        .mockResolvedValueOnce(undefined); // unlock

      await expect(service.createFirstAdmin(dto)).rejects.toThrow(ConflictException);

      const unlockCalls = runnerQuery.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock'),
      );
      expect(unlockCalls).toHaveLength(1);
      expect(ds._queryRunner.release).toHaveBeenCalledTimes(1);
    });

    describe('recovery branch', () => {
      it('completes verification when the only existing user is unverified and matches the DTO email', async () => {
        runnerQuery
          .mockResolvedValueOnce(undefined) // lock
          .mockResolvedValueOnce([{ count: '1' }]) // count = 1
          .mockResolvedValueOnce([{ email: 'founder@example.com' }]) // unverified match
          .mockResolvedValueOnce(undefined) // UPDATE emailVerified
          .mockResolvedValueOnce(undefined); // unlock

        await service.createFirstAdmin(dto);

        expect(auth.api.signUpEmail).not.toHaveBeenCalled();
        const updateCall = runnerQuery.mock.calls.find(
          (c) =>
            typeof c[0] === 'string' &&
            c[0].includes('UPDATE "user"') &&
            c[0].includes('emailVerified'),
        );
        expect(updateCall).toBeDefined();
        expect(updateCall?.[1]).toEqual(['founder@example.com']);
      });

      it('throws ConflictException when count=1 but the existing user is already verified', async () => {
        runnerQuery
          .mockResolvedValueOnce(undefined) // lock
          .mockResolvedValueOnce([{ count: '1' }]) // count = 1
          .mockResolvedValueOnce([]) // no unverified users
          .mockResolvedValueOnce(undefined); // unlock

        await expect(service.createFirstAdmin(dto)).rejects.toThrow(ConflictException);
        expect(auth.api.signUpEmail).not.toHaveBeenCalled();
      });

      it('throws ConflictException when count=1 but email does not match', async () => {
        runnerQuery
          .mockResolvedValueOnce(undefined) // lock
          .mockResolvedValueOnce([{ count: '1' }]) // count = 1
          .mockResolvedValueOnce([]) // unverified query with matching email returns none
          .mockResolvedValueOnce(undefined); // unlock

        await expect(service.createFirstAdmin(dto)).rejects.toThrow(ConflictException);
        expect(auth.api.signUpEmail).not.toHaveBeenCalled();
      });
    });

    it('does not wrap the flow in a TypeORM transaction', async () => {
      // If we ever revert to this.dataSource.transaction(), a rollback
      // would leave the Better Auth user insert committed on its own
      // pool while the emailVerified update gets reverted. The current
      // implementation uses a session-level advisory lock instead.
      mockHappyPath();
      (auth.api.signUpEmail as jest.Mock).mockResolvedValueOnce({});

      await service.createFirstAdmin(dto);

      expect(ds.createQueryRunner).toHaveBeenCalledTimes(1);
    });
  });
});
