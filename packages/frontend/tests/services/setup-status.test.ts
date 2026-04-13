import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkNeedsSetup,
  resetSetupStatus,
  createFirstAdmin,
} from '../../src/services/setup-status';

describe('setup-status service', () => {
  beforeEach(() => {
    resetSetupStatus();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('checkNeedsSetup', () => {
    it('returns true when backend reports needsSetup=true', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ needsSetup: true }),
        }),
      );
      expect(await checkNeedsSetup()).toBe(true);
    });

    it('returns false when backend reports needsSetup=false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ needsSetup: false }),
        }),
      );
      expect(await checkNeedsSetup()).toBe(false);
    });

    it('returns false on HTTP error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({}),
        }),
      );
      expect(await checkNeedsSetup()).toBe(false);
    });

    it('returns false on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      expect(await checkNeedsSetup()).toBe(false);
    });

    it('caches the result across calls', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ needsSetup: true }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await checkNeedsSetup();
      await checkNeedsSetup();
      await checkNeedsSetup();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after resetSetupStatus()', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ needsSetup: true }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await checkNeedsSetup();
      resetSetupStatus();
      await checkNeedsSetup();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('createFirstAdmin', () => {
    it('POSTs the admin payload as JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
      vi.stubGlobal('fetch', fetchMock);

      await createFirstAdmin({
        email: 'founder@example.com',
        name: 'Founder',
        password: 'secretpassword',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/setup/admin',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({
        email: 'founder@example.com',
        name: 'Founder',
        password: 'secretpassword',
      });
    });

    it('throws with server message when request fails with JSON body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({ message: 'Setup already completed' }),
        }),
      );
      await expect(
        createFirstAdmin({ email: 'a@b.com', name: 'X', password: '12345678' }),
      ).rejects.toThrow('Setup already completed');
    });

    it('flattens array error messages', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ message: ['email must be valid', 'name is required'] }),
        }),
      );
      await expect(
        createFirstAdmin({ email: 'bad', name: '', password: '12345678' }),
      ).rejects.toThrow('email must be valid, name is required');
    });

    it('falls back to generic error when body is not JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error('not json');
          },
        }),
      );
      await expect(
        createFirstAdmin({ email: 'a@b.com', name: 'X', password: '12345678' }),
      ).rejects.toThrow('Setup failed (500)');
    });

    it('resets cached setup status after success', async () => {
      // Prime the cache
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ needsSetup: true }),
        }),
      );
      await checkNeedsSetup();

      // Swap fetch mock for create
      const createMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
      vi.stubGlobal('fetch', createMock);

      await createFirstAdmin({ email: 'a@b.com', name: 'X', password: '12345678' });

      // Next check should re-fetch
      const statusMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ needsSetup: false }),
      });
      vi.stubGlobal('fetch', statusMock);

      expect(await checkNeedsSetup()).toBe(false);
      expect(statusMock).toHaveBeenCalled();
    });
  });
});
