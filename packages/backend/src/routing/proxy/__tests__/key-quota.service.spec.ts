import { KeyQuotaService } from '../key-quota.service';

describe('KeyQuotaService', () => {
  let quota: KeyQuotaService;

  beforeEach(() => {
    quota = new KeyQuotaService();
  });

  const headers = (h: Record<string, string>): Headers => {
    const out = new Headers();
    for (const [k, v] of Object.entries(h)) out.set(k, v);
    return out;
  };

  describe('recordAttemptResult — status gating', () => {
    it('ignores non-quota statuses entirely', () => {
      for (const status of [200, 201, 400, 401, 404, 500, 503]) {
        expect(
          quota.recordAttemptResult({
            agentId: 'a1',
            provider: 'openai',
            authType: 'api_key',
            providerKeyLabel: 'Work',
            status,
            errorBody: 'exceeded your current quota',
          }),
        ).toBeNull();
      }
    });

    it('ignores quota-relevant statuses when agentId/authType are missing', () => {
      expect(
        quota.recordAttemptResult({
          provider: 'openai',
          authType: 'api_key',
          status: 429,
          errorBody: 'quota',
        }),
      ).toBeNull();
      expect(
        quota.recordAttemptResult({
          agentId: 'a1',
          provider: 'openai',
          status: 429,
          errorBody: 'quota',
        }),
      ).toBeNull();
    });
  });

  describe('recordAttemptResult — Retry-After header', () => {
    it('marks week exhaustion when retry-after exceeds 24h', () => {
      const info = quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'openai',
        authType: 'api_key',
        providerKeyLabel: 'Work',
        status: 429,
        headers: headers({ 'retry-after': '90000' }),
        errorBody: '',
      });
      expect(info?.reason).toBe('week');
      expect(info!.exhaustedUntil).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    });

    it('marks day exhaustion when retry-after is between 1h and 24h', () => {
      const info = quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'openai',
        authType: 'api_key',
        status: 429,
        headers: headers({ 'retry-after': '7200' }),
        errorBody: '',
      });
      expect(info?.reason).toBe('day');
    });

    it('treats a short retry-after as a transient burst (no exhaustion)', () => {
      const info = quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'openai',
        authType: 'api_key',
        status: 429,
        headers: headers({ 'retry-after': '60' }),
        errorBody: '',
      });
      expect(info).toBeNull();
    });
  });

  describe('recordAttemptResult — error body language', () => {
    it.each([
      ['weekly quota exceeded', 'week'],
      ['You have exceeded your weekly free limit', 'week'],
      ['quota limit reached for 7 days', 'week'],
      ['exceeded your daily quota', 'day'],
      ['Daily free-tier limit reached', 'day'],
      ['quota exceeded for today', 'day'],
      ['insufficient_quota', 'day'],
      ['You exceeded your current quota, please check your plan and billing details.', 'day'],
      ['Resource has been exhausted (e.g. check quota).', 'day'],
      ['free tier quota exceeded', 'day'],
      ['hourly quota exceeded', 'hour'],
      ['Quota exceeded for quota metric "Generate Content API requests per hour"', 'hour'],
    ])('detects %s as %s', (body, expected) => {
      const info = quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'gemini',
        authType: 'api_key',
        providerKeyLabel: 'Default',
        status: 429,
        errorBody: JSON.stringify({ error: { message: body } }),
      });
      expect(info?.reason).toBe(expected);
    });

    it('never freezes on per-minute / per-second quota limits, even when repeated', () => {
      for (let i = 0; i < 10; i++) {
        expect(
          quota.recordAttemptResult({
            agentId: 'a1',
            provider: 'gemini',
            authType: 'api_key',
            status: 429,
            errorBody:
              'Quota exceeded for quota metric "Generate Content API requests per minute" and ' +
              'limit "Generate Content API requests per minute per user per 100 seconds".',
          }),
        ).toBeNull();
      }
    });

    it('never escalates a bare "rate limit" 429 to exhaustion', () => {
      for (let i = 0; i < 10; i++) {
        expect(
          quota.recordAttemptResult({
            agentId: 'a1',
            provider: 'openai',
            authType: 'api_key',
            status: 429,
            errorBody: 'rate limit reached, retry later',
          }),
        ).toBeNull();
      }
    });

    it('detects the OpenCode Zen free-usage limit and freezes for the stated reset time', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-13T12:00:00Z'));
      const info = quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'opencode-zen',
        authType: 'api_key',
        providerKeyLabel: 'Dev',
        status: 429,
        errorBody: JSON.stringify({
          type: 'FreeUsageLimitError',
          message:
            'Free usage exceeded, add credits https://opencode.ai/zen [retrying in 10h 37m attempt #1]',
        }),
      });
      jest.useRealTimers();
      expect(info?.reason).toBe('day');
      // Stated reset: 10h37m from detection → 22:37:00Z.
      expect(info!.exhaustedUntil).toBe(new Date('2026-08-13T22:37:00Z').getTime());
    });

    it('detects the Zen free-usage limit without an embedded timer as a day freeze', () => {
      const info = quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'opencode-zen',
        authType: 'api_key',
        status: 429,
        errorBody: '{"type":"FreeUsageLimitError","message":"Free usage exceeded"}',
      });
      expect(info?.reason).toBe('day');
    });
  });

  describe('recordAttemptResult — sliding window', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('marks day exhaustion after 3+ quota-flavored 429s within 5 minutes', () => {
      let info = null;
      for (let i = 0; i < 3; i++) {
        info = quota.recordAttemptResult({
          agentId: 'a1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Work',
          status: 429,
          errorBody: 'You have exceeded your current quota',
        });
        jest.advanceTimersByTime(60_000);
      }
      expect(info?.reason).toBe('day');
    });

    it('does not exhaust from 2 quota-flavored 429s', () => {
      let info = null;
      for (let i = 0; i < 2; i++) {
        info = quota.recordAttemptResult({
          agentId: 'a1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Work',
          status: 429,
          errorBody: 'quota exceeded',
        });
      }
      expect(info).toBeNull();
    });

    it('does not accumulate toward a freeze when the provider sends a short Retry-After', () => {
      // RPM bursts carry a short retry-after: even 6 window-eligible bodies in
      // a row must not escalate — the provider explicitly called it transient.
      let info = null;
      for (let i = 0; i < 6; i++) {
        info = quota.recordAttemptResult({
          agentId: 'a1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Work',
          status: 429,
          headers: headers({ 'retry-after': '30' }),
          errorBody: 'quota exceeded',
        });
        jest.advanceTimersByTime(30_000);
      }
      expect(info).toBeNull();
    });

    it('freezes an hourly quota until the end of the current UTC hour', () => {
      jest.setSystemTime(new Date('2026-08-13T14:05:00Z'));
      const info = quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'gemini',
        authType: 'api_key',
        status: 429,
        errorBody: 'hourly quota exceeded',
      });
      expect(info?.reason).toBe('hour');
      const until = new Date(info!.exhaustedUntil);
      expect(until.toISOString()).toBe('2026-08-13T15:00:00.000Z');
    });

    it('forgets old failures outside the window before escalating', () => {
      for (let i = 0; i < 2; i++) {
        quota.recordAttemptResult({
          agentId: 'a1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Work',
          status: 429,
          errorBody: 'quota exceeded',
        });
      }
      jest.advanceTimersByTime(6 * 60 * 1000); // window lapses
      expect(
        quota.recordAttemptResult({
          agentId: 'a1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Work',
          status: 429,
          errorBody: 'quota exceeded',
        }),
      ).toBeNull();
    });

    it('keeps failure counters per key, not shared across keys', () => {
      for (let i = 0; i < 3; i++) {
        quota.recordAttemptResult({
          agentId: 'a1',
          provider: 'openai',
          authType: 'api_key',
          providerKeyLabel: 'Work',
          status: 429,
          errorBody: 'quota exceeded',
        });
      }
      expect(quota.isKeyQuotaExhausted('a1', 'openai', 'api_key', 'Work')).not.toBeNull();
      expect(quota.isKeyQuotaExhausted('a1', 'openai', 'api_key', 'Personal')).toBeNull();
    });
  });

  describe('remainingLabel', () => {
    it('renders hours and minutes', () => {
      const q = new KeyQuotaService();
      const now = Date.now();
      expect(q.remainingLabel(now + 6 * 3_600_000 + 23 * 60_000, now)).toBe('6h 23m');
      expect(q.remainingLabel(now + 45 * 60_000, now)).toBe('45m');
      expect(q.remainingLabel(now + 5000, now)).toBe('5s');
      expect(q.remainingLabel(now - 1000, now)).toBe('1s');
    });
  });

  describe('listFreezes and resume', () => {
    it("lists only this agent's active freezes with structured fields", () => {
      quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'gemini',
        authType: 'api_key',
        providerKeyLabel: 'Dev',
        status: 429,
        errorBody: 'daily quota exceeded',
      });
      quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'opencode-zen',
        authType: 'api_key',
        status: 429,
        errorBody: 'You have exceeded your current daily quota',
      });
      quota.recordAttemptResult({
        agentId: 'a2',
        provider: 'openai',
        authType: 'api_key',
        status: 429,
        errorBody: 'daily quota exceeded',
      });

      const freezes = quota.listFreezes('a1');
      expect(freezes).toHaveLength(2);
      const gemini = freezes.find((f) => f.provider === 'gemini');
      expect(gemini).toMatchObject({
        authType: 'api_key',
        providerKeyLabel: 'Dev',
        reason: 'day',
      });
      expect(gemini!.remainingMs).toBeGreaterThan(0);
      expect(gemini!.remainingLabel).toMatch(/\d+[hm]/);
      expect(gemini!.exhaustedUntil).toBeGreaterThan(Date.now());
      // a2's freeze is not visible from a1.
      expect(freezes.some((f) => f.provider === 'openai')).toBe(false);
    });

    it('resume clears the freeze for one key and lets it be retried immediately', () => {
      quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'gemini',
        authType: 'api_key',
        providerKeyLabel: 'Work',
        status: 429,
        errorBody: 'daily quota exceeded',
      });
      quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'gemini',
        authType: 'api_key',
        providerKeyLabel: 'Personal',
        status: 429,
        errorBody: 'daily quota exceeded',
      });
      expect(quota.isKeyQuotaExhausted('a1', 'gemini', 'api_key', 'Work')).not.toBeNull();

      quota.resume('a1', 'gemini', 'api_key', 'Work');
      expect(quota.isKeyQuotaExhausted('a1', 'gemini', 'api_key', 'Work')).toBeNull();
      // Other labels are untouched.
      expect(quota.isKeyQuotaExhausted('a1', 'gemini', 'api_key', 'Personal')).not.toBeNull();
      // Resume also clears the sliding-window counters for that key.
      expect(quota.listFreezes('a1')).toHaveLength(1);
    });

    it('resume with the default label clears the unlabeled default key', () => {
      quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'gemini',
        authType: 'api_key',
        status: 429,
        errorBody: 'daily quota exceeded',
      });
      expect(quota.isKeyQuotaExhausted('a1', 'gemini', 'api_key')).not.toBeNull();
      quota.resume('a1', 'gemini', 'api_key');
      expect(quota.isKeyQuotaExhausted('a1', 'gemini', 'api_key')).toBeNull();
    });
  });

  describe('isKeyQuotaExhausted', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns null when nothing was recorded for the key', () => {
      expect(quota.isKeyQuotaExhausted('a1', 'openai', 'api_key', 'Work')).toBeNull();
    });

    it('returns the info while exhausted and nulls after expiry', () => {
      quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'openai',
        authType: 'api_key',
        providerKeyLabel: 'Work',
        status: 429,
        errorBody: 'daily quota exceeded',
      });
      expect(quota.isKeyQuotaExhausted('a1', 'openai', 'api_key', 'Work')).not.toBeNull();
      jest.advanceTimersByTime(25 * 60 * 60 * 1000); // past end of day
      expect(quota.isKeyQuotaExhausted('a1', 'openai', 'api_key', 'Work')).toBeNull();
    });

    it('resolves the default (undefined) label independently from labeled keys', () => {
      quota.recordAttemptResult({
        agentId: 'a1',
        provider: 'openai',
        authType: 'api_key',
        status: 429,
        errorBody: 'daily quota exceeded',
      });
      expect(quota.isKeyQuotaExhausted('a1', 'openai', 'api_key')).not.toBeNull();
      expect(quota.isKeyQuotaExhausted('a1', 'openai', 'api_key', 'Work')).toBeNull();
    });
  });
});
