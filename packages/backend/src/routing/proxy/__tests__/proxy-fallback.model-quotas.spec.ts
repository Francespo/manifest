import { Repository } from 'typeorm';
import { ProxyFallbackService } from '../proxy-fallback.service';
import { ProviderKeyService } from '../../routing-core/provider-key.service';
import { CustomProvider } from '../../../entities/custom-provider.entity';
import { OpenaiOauthService } from '../../oauth/openai/openai-oauth.service';
import { MinimaxOauthService } from '../../oauth/minimax/minimax-oauth.service';
import { AnthropicOauthService } from '../../oauth/anthropic/anthropic-oauth.service';
import { GeminiOauthService } from '../../oauth/gemini/gemini-oauth.service';
import { KiroOauthService } from '../../oauth/kiro/kiro-oauth.service';
import { XaiOauthService } from '../../oauth/xai/xai-oauth.service';
import { ProviderClient } from '../provider-client';
import { CopilotTokenService } from '../copilot-token.service';
import { ModelPricingCacheService } from '../../../model-prices/model-pricing-cache.service';
import { AgentModelParamsService } from '../../routing-core/agent-model-params.service';
import { ProviderParamSpecService } from '../../routing-core/provider-param-spec.service';
import { ReasoningContentCache } from '../reasoning-content-cache';
import { KeyRotationRuleService } from '../../routing-core/key-rotation-rule.service';
import { ModelQuotaLimiterService } from '../model-quota/model-quota-limiter.service';

describe('ProxyFallbackService with ModelQuotaLimiter', () => {
  let service: ProxyFallbackService;
  let quotaLimiter: ModelQuotaLimiterService;
  let providerClient: jest.Mocked<ProviderClient>;
  let providerKeyService: jest.Mocked<ProviderKeyService>;

  beforeEach(() => {
    providerKeyService = {
      getProviderApiKey: jest.fn().mockResolvedValue('test-google-key'),
      getProviderKeyId: jest.fn().mockResolvedValue('tp-1'),
      getAuthType: jest.fn().mockResolvedValue('api_key'),
      findProviderForModel: jest.fn().mockResolvedValue(undefined),
      getProviderRegion: jest.fn().mockResolvedValue(null),
      hasActiveProvider: jest.fn().mockResolvedValue(true),
      selectProviderKey: jest.fn().mockResolvedValue({
        apiKey: 'test-google-key',
        id: 'tp-1',
        region: null,
        label: 'Mario',
        priority: 0,
      }),
    } as unknown as jest.Mocked<ProviderKeyService>;

    providerClient = {
      forward: jest.fn(),
      forwardChatGpt: jest.fn(),
    } as unknown as jest.Mocked<ProviderClient>;

    const customProviderRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<Repository<CustomProvider>>;

    const oauthStub = { unwrapToken: jest.fn().mockResolvedValue(null) };

    quotaLimiter = new ModelQuotaLimiterService();

    service = new ProxyFallbackService(
      providerKeyService,
      customProviderRepo,
      oauthStub as unknown as OpenaiOauthService,
      oauthStub as unknown as MinimaxOauthService,
      oauthStub as unknown as AnthropicOauthService,
      oauthStub as unknown as GeminiOauthService,
      oauthStub as unknown as KiroOauthService,
      oauthStub as unknown as XaiOauthService,
      providerClient,
      { getCopilotToken: jest.fn().mockResolvedValue('token') } as unknown as CopilotTokenService,
      { getByModel: jest.fn().mockReturnValue(null) } as unknown as ModelPricingCacheService,
      {
        get: jest.fn().mockResolvedValue(null),
        list: jest.fn().mockResolvedValue([]),
      } as unknown as AgentModelParamsService,
      { getSpecs: jest.fn().mockResolvedValue([]) } as unknown as ProviderParamSpecService,
      {
        prepareRequest: jest.fn().mockImplementation((b) => b),
        recordResponse: jest.fn(),
      } as unknown as ReasoningContentCache,
      {} as unknown as KeyRotationRuleService,
      quotaLimiter,
    );
  });

  afterEach(() => {
    quotaLimiter.onModuleDestroy();
  });

  it('skips Gemini Flash when single-request tokens exceed 250k without making HTTP call', async () => {
    const largePrompt = 'a'.repeat(1_000_000); // ~260k tokens
    const body = { messages: [{ role: 'user', content: largePrompt }] };

    const result = await service.tryForwardToProvider({
      provider: 'google',
      model: 'gemini-3.7-flash',
      apiKey: 'test-google-key',
      body,
      stream: false,
      sessionKey: 's1',
      providerKeyLabel: 'Mario',
      tenantProviderId: 'tp-1',
    });

    expect(result.providerCallStarted).toBe(false);
    expect(result.response.status).toBe(429);
    const text = await result.response.text();
    expect(text).toContain('exceeding the 250,000 limit');
    expect(providerClient.forward).not.toHaveBeenCalled();
  });

  it('skips Gemini Flash when 1-minute RPM reaches 5 without making HTTP call', async () => {
    // Record 5 successful attempts
    for (let i = 0; i < 5; i++) {
      quotaLimiter.recordAttemptSuccess({
        provider: 'google',
        model: 'gemini-3.7-flash',
        key: 'test-google-key',
        keyLabel: 'Mario',
        tenantProviderId: 'tp-1',
        inputTokens: 100,
      });
    }

    const result = await service.tryForwardToProvider({
      provider: 'google',
      model: 'gemini-3.7-flash',
      apiKey: 'test-google-key',
      body: { messages: [{ role: 'user', content: 'hello' }] },
      stream: false,
      sessionKey: 's1',
      providerKeyLabel: 'Mario',
      tenantProviderId: 'tp-1',
    });

    expect(result.providerCallStarted).toBe(false);
    expect(result.response.status).toBe(429);
    const text = await result.response.text();
    expect(text).toContain('1-minute request rate limit reached');
    expect(providerClient.forward).not.toHaveBeenCalled();
  });

  it('records successful calls and increments quota counters', async () => {
    providerClient.forward.mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      isGoogle: true,
      isAnthropic: false,
      isChatGpt: false,
      providerCallStarted: true,
    });

    const result = await service.tryForwardToProvider({
      provider: 'google',
      model: 'gemini-3.7-flash',
      apiKey: 'test-google-key',
      body: { messages: [{ role: 'user', content: 'hello' }] },
      stream: false,
      sessionKey: 's1',
      providerKeyLabel: 'Mario',
      tenantProviderId: 'tp-1',
    });

    expect(result.providerCallStarted).toBe(true);
    expect(result.response.status).toBe(200);

    const statuses = quotaLimiter.getAllBucketStatuses();
    const marioBucket = statuses.find((s) => s.keyLabel === 'Mario');
    expect(marioBucket).toBeDefined();
    expect(marioBucket?.rpmUsed).toBe(1);
    expect(marioBucket?.rpdUsed).toBe(1);
  });
});
