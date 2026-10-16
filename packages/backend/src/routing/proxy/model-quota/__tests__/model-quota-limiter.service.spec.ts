import { ModelQuotaLimiterService } from '../model-quota-limiter.service';
import { estimatePayloadInputTokens } from '../fast-token-estimator';
import { findQuotaRule } from '../default-model-quotas';

describe('ModelQuotaLimiter & Token Estimator', () => {
  describe('estimatePayloadInputTokens', () => {
    it('estimates tokens from messages array', () => {
      const body = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello, how are you today?' },
        ],
      };
      const tokens = estimatePayloadInputTokens(body);
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(100);
    });

    it('estimates tokens from large payload', () => {
      const largeText = 'a'.repeat(380_000);
      const body = {
        messages: [{ role: 'user', content: largeText }],
      };
      const tokens = estimatePayloadInputTokens(body);
      expect(tokens).toBeGreaterThanOrEqual(100_000);
    });

    it('handles Google contents format and tools', () => {
      const body = {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Calculate this formula' }],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'calculator',
                description: 'A simple calculator tool',
                parameters: { type: 'object', properties: { expr: { type: 'string' } } },
              },
            ],
          },
        ],
      };
      const tokens = estimatePayloadInputTokens(body);
      expect(tokens).toBeGreaterThan(10);
    });
  });

  describe('findQuotaRule', () => {
    it('matches Gemini Flash models', () => {
      const rule1 = findQuotaRule('google', 'gemini-3.7-flash');
      expect(rule1).not.toBeNull();
      expect(rule1?.modelFamily).toBe('gemini-flash');
      expect(rule1?.maxRpm).toBe(5);
      expect(rule1?.maxRpd).toBe(20);
      expect(rule1?.maxTpm).toBe(250_000);

      const rule2 = findQuotaRule('gemini', 'gemini-2.5-flash');
      expect(rule2).not.toBeNull();
      expect(rule2?.modelFamily).toBe('gemini-flash');
    });

    it('matches Gemini Flash-Lite models with higher limits', () => {
      const rule = findQuotaRule('google', 'gemini-3.5-flash-lite');
      expect(rule).not.toBeNull();
      expect(rule?.modelFamily).toBe('gemini-flash-lite');
      expect(rule?.maxRpm).toBe(15);
      expect(rule?.maxRpd).toBe(500);
      expect(rule?.maxTpm).toBe(250_000);
    });

    it('returns null for models without predefined quota limits', () => {
      const rule = findQuotaRule('openai', 'gpt-4o');
      expect(rule).toBeNull();
    });
  });

  describe('ModelQuotaLimiterService', () => {
    let service: ModelQuotaLimiterService;

    beforeEach(() => {
      service = new ModelQuotaLimiterService();
    });

    afterEach(() => {
      service.onModuleDestroy();
    });

    it('allows initial request within limits', () => {
      const check = service.checkQuota({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key: 'test-key-mario',
        keyLabel: 'Mario',
        estimatedTokens: 1000,
      });
      expect(check.allowed).toBe(true);
    });

    it('skips request if estimated tokens exceed single request limit (250k)', () => {
      const check = service.checkQuota({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key: 'test-key-mario',
        keyLabel: 'Mario',
        estimatedTokens: 300_000,
      });
      expect(check.allowed).toBe(false);
      expect(check.ruleType).toBe('single_request_tokens');
      expect(check.reason).toContain('exceeding the 250,000 limit');
    });

    it('enforces 1-minute RPM limit (5 RPM for Flash)', () => {
      const key = 'test-key-mario';
      for (let i = 0; i < 5; i++) {
        expect(
          service.checkQuota({
            provider: 'google',
            model: 'gemini-3.7-flash',
            key,
            keyLabel: 'Mario',
            estimatedTokens: 100,
          }).allowed,
        ).toBe(true);
        service.recordAttemptSuccess({
          provider: 'google',
          model: 'gemini-3.7-flash',
          key,
          keyLabel: 'Mario',
          inputTokens: 100,
        });
      }

      // 6th request in the same minute should be rejected
      const check = service.checkQuota({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        estimatedTokens: 100,
      });
      expect(check.allowed).toBe(false);
      expect(check.ruleType).toBe('rpm');
      expect(check.reason).toContain('1-minute request rate limit reached');
    });

    it('enforces 1-minute TPM limit (250k TPM across multiple requests)', () => {
      const key = 'test-key-mario';
      service.recordAttemptSuccess({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        inputTokens: 140_000,
      });
      service.recordAttemptSuccess({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        inputTokens: 100_000,
      });

      // Total used is 240,000. Next request with 20,000 tokens brings it to 260,000 > 250,000
      const check = service.checkQuota({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        estimatedTokens: 20_000,
      });
      expect(check.allowed).toBe(false);
      expect(check.ruleType).toBe('tpm');
      expect(check.reason).toContain('1-minute token quota exceeded');
    });

    it('enforces daily RPD limit (20 RPD for Flash)', () => {
      const key = 'test-key-mario';
      for (let i = 0; i < 20; i++) {
        service.recordAttemptSuccess({
          provider: 'google',
          model: 'gemini-3.7-flash',
          key,
          keyLabel: 'Mario',
          inputTokens: 10,
        });
      }

      const check = service.checkQuota({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        estimatedTokens: 10,
      });
      expect(check.allowed).toBe(false);
      expect(check.ruleType).toBe('rpd');
      expect(check.reason).toContain('daily quota exhausted');
    });

    it('isolates different keys for the same model', () => {
      const keyMario = 'test-key-mario';
      const keyLuigi = 'test-key-luigi';

      // Exhaust Mario's daily quota
      for (let i = 0; i < 20; i++) {
        service.recordAttemptSuccess({
          provider: 'google',
          model: 'gemini-3.7-flash',
          key: keyMario,
          keyLabel: 'Mario',
          inputTokens: 10,
        });
      }

      // Mario is rejected
      expect(
        service.checkQuota({
          provider: 'google',
          model: 'gemini-3.7-flash',
          key: keyMario,
          keyLabel: 'Mario',
          estimatedTokens: 10,
        }).allowed,
      ).toBe(false);

      // Luigi is allowed!
      expect(
        service.checkQuota({
          provider: 'google',
          model: 'gemini-3.7-flash',
          key: keyLuigi,
          keyLabel: 'Luigi',
          estimatedTokens: 10,
        }).allowed,
      ).toBe(true);
    });

    it('deduces daily exhaustion from upstream 429 daily error message', () => {
      const key = 'test-key-mario';
      service.recordAttemptFailure({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        status: 429,
        errorBody: JSON.stringify({
          error: {
            code: 429,
            message: "Quota exceeded for quota metric 'GenerateContent requests per day'...",
          },
        }),
      });

      const check = service.checkQuota({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        estimatedTokens: 10,
      });
      expect(check.allowed).toBe(false);
      expect(check.ruleType).toBe('cooldown');
      expect(check.reason).toContain('Daily quota exhausted');
    });

    it('deduces daily exhaustion from repeated unexpected 429s (ghost traffic heuristic)', () => {
      const key = 'test-key-mario';
      // Local state is at 0 RPM and 0 TPM
      // 1st unexpected 429 sets short cooldown
      service.recordAttemptFailure({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        status: 429,
        errorBody: 'Resource has been exhausted',
      });

      // 2nd unexpected 429 deduces daily exhaustion!
      service.recordAttemptFailure({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        status: 429,
        errorBody: 'Resource has been exhausted',
      });

      const check = service.checkQuota({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key,
        keyLabel: 'Mario',
        estimatedTokens: 10,
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain(
        'Inferred daily quota exhaustion from untracked external activity',
      );
    });

    it('returns status for all tracked buckets via getAllBucketStatuses', () => {
      service.recordAttemptSuccess({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key: 'test-key-mario',
        keyLabel: 'Mario',
        inputTokens: 5000,
      });
      service.recordAttemptSuccess({
        provider: 'openai',
        model: 'gpt-4o',
        key: 'test-key-openai',
        keyLabel: 'WorkOpenAI',
        inputTokens: 2000,
      });

      const statuses = service.getAllBucketStatuses();
      expect(statuses.length).toBe(2);

      const geminiBucket = statuses.find((s) => s.provider === 'google');
      expect(geminiBucket).toBeDefined();
      expect(geminiBucket?.rpmLimit).toBe(5);
      expect(geminiBucket?.rpdLimit).toBe(20);
      expect(geminiBucket?.tpmLimit).toBe(250_000);
      expect(geminiBucket?.tpmUsed).toBe(5000);
      expect(geminiBucket?.rpdUsed).toBe(1);
      expect(geminiBucket?.status).toBe('active');

      const openaiBucket = statuses.find((s) => s.provider === 'openai');
      expect(openaiBucket).toBeDefined();
      expect(openaiBucket?.rpmLimit).toBeNull();
      expect(openaiBucket?.rpdUsed).toBe(1);
    });
  });
});
