import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { IncomingHttpHeaders } from 'http';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import {
  AUDIO_TRANSCRIPTION_ENDPOINT,
  AUDIO_TRANSLATION_ENDPOINT,
  GROQ_TRANSCRIPTION_MODEL_BY_ID,
  SUCCESS_STATUS,
  type AuthType,
  type TranscriptionResult,
} from 'manifest-shared';
import { AgentMessage } from '../../entities/agent-message.entity';
import { ManifestRequest } from '../../entities/request.entity';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { PlanService } from '../../billing/plan.service';
import { formatManifestError, type ManifestErrorCode } from '../../common/errors/error-codes';
import {
  MANIFEST_CODE_TO_REASON,
  ManifestError,
  isRecordableManifestCode,
} from '../../common/errors/manifest-error';
import type { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ProviderKeyService } from '../routing-core/provider-key.service';
import { OpenaiOauthService } from '../oauth/openai/openai-oauth.service';
import { MinimaxOauthService } from '../oauth/minimax/minimax-oauth.service';
import { AnthropicOauthService } from '../oauth/anthropic/anthropic-oauth.service';
import { GeminiOauthService } from '../oauth/gemini/gemini-oauth.service';
import { KiroOauthService } from '../oauth/kiro/kiro-oauth.service';
import { XaiOauthService } from '../oauth/xai/xai-oauth.service';
import { classifyCaller, type CallerAttribution } from '../proxy/caller-classifier';
import { ProxyMessageRecorder } from '../proxy/proxy-message-recorder';
import { ProxyRateLimiter } from '../proxy/proxy-rate-limiter';
import { sanitizeRequestHeaders } from '../proxy/request-headers';
import { resolveRouteCredentials } from '../proxy/route-credentials';
import { routeForOpenAiModelId } from '../proxy/openai-model-id';
import type { ProviderAttemptRef, ProviderAttemptStart } from '../proxy/proxy-types';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { AudioProviderClient, type AudioApiMode } from './audio-provider-client';
import { audioFieldsFromBody, validateAudioRequest, type AudioUpload } from './audio-validation';
import { audioCostUsd } from './audio-pricing';

const MODEL_UNAVAILABLE: ManifestErrorCode = 'M302';

export interface AudioCallInput {
  ctx: IngestionContext;
  body: Record<string, unknown>;
  headers: IncomingHttpHeaders;
  file?: AudioUpload;
  apiMode: AudioApiMode;
  ip?: string;
  signal?: AbortSignal;
  /** `X-Manifest-Async: true` returns a pollable task instead of the transcript. */
  async?: boolean;
}

export interface AudioCallResult {
  status: number;
  body: unknown;
  resolvedRoute?: AudioResolvedRoute | null;
  costUsd?: number | null;
}

export interface AudioResolvedRoute {
  provider: string;
  model: string;
  tier: string;
  reason: string;
}

interface ResolvedAudioRoute {
  route: { provider: string; model: string; authType: AuthType; keyLabel?: string | null };
  endpoints: readonly string[];
  tier: string;
  reason: string;
}

/** Stored payload behind `GET /v1/audio/transcriptions/{id}`. */
interface StoredAudioTask {
  model: string;
  apiMode: AudioApiMode;
  createdAt: number;
  result: TranscriptionResult;
}

/**
 * Serves speech-to-text through Manifest's routing.
 *
 * The flow mirrors MediaService: a Manifest Request is recorded at ingress,
 * the route is resolved to a concrete model, credentials come from the same
 * per-tenant provider keys, one Provider Attempt is recorded per upstream
 * call, and per-minute cost lands in `agent_messages` (tokens stay zero).
 */
@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    private readonly providerKeyService: ProviderKeyService,
    private readonly modelDiscovery: ModelDiscoveryService,
    private readonly audioClient: AudioProviderClient,
    private readonly recorder: ProxyMessageRecorder,
    private readonly rateLimiter: ProxyRateLimiter,
    private readonly planService: PlanService,
    private readonly openaiOauth: OpenaiOauthService,
    private readonly minimaxOauth: MinimaxOauthService,
    private readonly anthropicOauth: AnthropicOauthService,
    private readonly geminiOauth: GeminiOauthService,
    private readonly kiroOauth: KiroOauthService,
    private readonly xaiOauth: XaiOauthService,
    @InjectRepository(ManifestRequest)
    private readonly requestRepo: Repository<ManifestRequest>,
    @InjectRepository(AgentMessage)
    private readonly messageRepo: Repository<AgentMessage>,
  ) {}

  async handle(input: AudioCallInput): Promise<AudioCallResult> {
    const { ctx, headers, apiMode, signal, ip, file, async } = input;
    const fields = audioFieldsFromBody(input.body);
    const requested = requestedModelOf(input.body);
    const requestId = uuid();
    const traceId = extractTraceId(headers);
    const callerAttribution = classifyCaller(headers);
    const requestHeaders = sanitizeRequestHeaders(headers);
    const sessionKey = extractSessionKey(headers);
    const startedAt = Date.now();

    await this.recorder
      .recordPendingRequest(ctx, {
        requestId,
        timestamp: new Date(startedAt).toISOString(),
        traceId,
        sessionKey,
        requestedModel: requested,
        callerAttribution,
        requestHeaders,
        apiMode,
      })
      .catch((e) => this.logger.warn(`Failed to record pending audio Request: ${e}`));

    let slotAcquired = false;
    try {
      await this.planService.assertWithinRequestLimit(ctx);
      this.rateLimiter.checkLimit(ctx.tenantId);
      this.rateLimiter.checkIpLimit(ip ?? '');
      this.rateLimiter.acquireSlot(ctx.tenantId);
      slotAcquired = true;
    } catch (err) {
      return this.recordManifestFailure(err, {
        ctx,
        requestId,
        traceId,
        callerAttribution,
        requestHeaders,
        apiMode,
        startedAt,
      });
    }

    try {
      const resolved = await this.resolveRoute(ctx, requested);
      if (!resolved) {
        return this.recordManifestFailure(
          new ManifestError(MODEL_UNAVAILABLE, HttpStatus.BAD_REQUEST, {
            model: requested ?? 'auto',
            dashboardUrl: 'the dashboard',
          }),
          { ctx, requestId, traceId, callerAttribution, requestHeaders, apiMode, startedAt },
        );
      }

      const expected =
        apiMode === 'transcriptions' ? AUDIO_TRANSCRIPTION_ENDPOINT : AUDIO_TRANSLATION_ENDPOINT;
      // Capability gate: a chat model cannot serve an audio endpoint. Checked
      // before credentials or provider work, like the media modality gate.
      if (!resolved.endpoints.includes(expected)) {
        return this.recordManifestFailure(
          new ManifestError('M304', HttpStatus.BAD_REQUEST, {
            modality: 'audio',
            reason: `model "${resolved.route.model}" does not support ${expected}`,
          }),
          { ctx, requestId, traceId, callerAttribution, requestHeaders, apiMode, startedAt },
        );
      }

      const invalidReason = validateAudioRequest({
        provider: resolved.route.provider,
        apiMode,
        model: resolved.route.model,
        body: input.body,
        file,
        fields,
      });
      if (invalidReason) {
        return this.recordManifestFailure(
          new ManifestError('M304', HttpStatus.BAD_REQUEST, {
            modality: 'audio',
            reason: invalidReason,
          }),
          { ctx, requestId, traceId, callerAttribution, requestHeaders, apiMode, startedAt },
        );
      }

      const credentials = await resolveRouteCredentials(this.credentialDeps(), {
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        provider: resolved.route.provider,
        authType: resolved.route.authType,
        providerKeyLabel: resolved.route.keyLabel ?? undefined,
      });
      if (!credentials.ok) {
        return this.recordManifestFailure(
          new ManifestError(
            credentials.reason === 'no_provider_key' ? 'M100' : 'M102',
            HttpStatus.UNAUTHORIZED,
            { provider: resolved.route.provider, dashboardUrl: 'the dashboard' },
          ),
          { ctx, requestId, traceId, callerAttribution, requestHeaders, apiMode, startedAt },
        );
      }

      const attempt = this.startAttempt(ctx, requestId, {
        provider: resolved.route.provider,
        model: resolved.route.model,
        authType: resolved.route.authType,
        tenantProviderId: credentials.tenantProviderId,
        keyLabel: credentials.keyLabel,
      });

      const forward = await this.audioClient.forward({
        provider: resolved.route.provider,
        apiKey: credentials.apiKey,
        model: resolved.route.model,
        apiMode,
        fields,
        file,
        signal,
      });

      if (!forward.ok) {
        attempt.completeFailure?.({
          status: forward.status,
          errorBody: stringifyError(forward.body),
          superseded: false,
        });
        await this.recorder
          .recordProviderError(ctx, forward.status, stringifyError(forward.body), {
            requestId,
            attempt,
            attemptNumber: attempt.attemptNumber,
            model: resolved.route.model,
            provider: resolved.route.provider,
            tier: resolved.tier,
            reason: resolved.reason,
            authType: resolved.route.authType,
            providerKeyLabel: credentials.keyLabel,
            tenantProviderId: credentials.tenantProviderId,
            callerAttribution,
            requestHeaders,
            requestDurationMs: Date.now() - startedAt,
            apiMode,
          })
          .catch((e) => this.logger.warn(`Failed to record audio provider error: ${e}`));
        return { status: forward.status, body: errorEnvelope(forward.status, forward.body) };
      }

      const costUsd = audioCostUsd(
        resolved.route.provider,
        resolved.route.model,
        forward.seconds,
      );
      await this.recorder
        .recordSuccessMessage(
          ctx,
          resolved.route.model,
          resolved.tier,
          resolved.reason,
          { prompt_tokens: 0, completion_tokens: 0 },
          {
            requestId,
            attempt,
            attemptNumber: attempt.attemptNumber,
            traceId,
            provider: resolved.route.provider,
            authType: resolved.route.authType,
            sessionKey,
            durationMs: Date.now() - startedAt,
            providerKeyLabel: credentials.keyLabel,
            tenantProviderId: credentials.tenantProviderId,
            callerAttribution,
            requestHeaders,
            apiMode,
            costUsdOverride: costUsd,
          },
        )
        .catch((e) => this.logger.warn(`Failed to record audio success: ${e}`));

      let responseBody = forward.body;
      if (async && forward.result) {
        const taskId = `atr_${uuid()}`;
        const stored: StoredAudioTask = {
          model: resolved.route.model,
          apiMode,
          createdAt: Math.floor(startedAt / 1000),
          result: forward.result,
        };
        await this.attachAudioTask(requestId, taskId, stored).catch((e) =>
          this.logger.warn(`Failed to attach audio task id: ${e}`),
        );
        responseBody = toTaskObject(taskId, stored);
      }

      return {
        status: forward.status,
        body: responseBody,
        resolvedRoute: {
          provider: resolved.route.provider,
          model: resolved.route.model,
          tier: resolved.tier,
          reason: resolved.reason,
        },
        costUsd,
      };
    } catch (err) {
      return this.recordManifestFailure(err, {
        ctx,
        requestId,
        traceId,
        callerAttribution,
        requestHeaders,
        apiMode,
        startedAt,
      });
    } finally {
      if (slotAcquired) this.rateLimiter.releaseSlot(ctx.tenantId);
    }
  }

  /**
   * Read a stored speech-to-text task. Groq does not retain transcripts, so
   * this is a local read of the Manifest Request — no provider call and no
   * second Provider Attempt. Cost is finalized if the create had no duration.
   */
  async taskStatus(ctx: IngestionContext, taskId: string): Promise<AudioCallResult> {
    const request = await this.requestRepo.findOne({
      where: { tenant_id: ctx.tenantId, audio_task_id: taskId },
    });
    if (!request || request.agent_id !== ctx.agentId) {
      return {
        status: 404,
        body: {
          error: { message: `Audio task "${taskId}" not found`, type: 'invalid_request_error' },
        },
      };
    }

    const stored = asStoredTask(request.audio_result);
    if (!stored) {
      return {
        status: 409,
        body: {
          error: { message: 'Audio task has no stored transcript', type: 'server_error' },
        },
      };
    }

    const attempt = await this.messageRepo.findOne({
      where: { request_id: request.id },
      order: { attempt_number: 'DESC' },
    });
    let costUsd: number | null = null;
    if (attempt?.provider && attempt.model && stored.result.duration !== undefined) {
      costUsd = audioCostUsd(attempt.provider, attempt.model, stored.result.duration);
      if (costUsd !== null && attempt.cost_usd == null) {
        await this.messageRepo
          .update({ id: attempt.id }, { cost_usd: costUsd, status: SUCCESS_STATUS })
          .catch((e) => this.logger.warn(`Failed to finalize audio task cost: ${e}`));
      }
    }

    return { status: 200, body: toTaskObject(taskId, stored), costUsd };
  }

  /* ── Resolution ──────────────────────────────────────────────────── */

  /**
   * Transcription routes are model-only by design (no synthetic audio tiers):
   * resolve the published id exactly like the chat proxy, then let the
   * capability gate decide whether this model serves the requested endpoint.
   */
  private async resolveRoute(
    ctx: IngestionContext,
    requested: string | undefined,
  ): Promise<ResolvedAudioRoute | null> {
    if (!requested) return null;
    const discovered = await this.modelDiscovery.getModelsForAgent(ctx.tenantId, ctx.agentId);
    const route = routeForOpenAiModelId(requested, discovered);
    if (!route) return null;
    const match =
      discovered.find(
        (m) => m.id === route.model && m.provider.toLowerCase() === route.provider.toLowerCase(),
      ) ?? discovered.find((m) => m.id === route.model);
    return {
      route,
      endpoints: supportedAudioEndpoints(route.provider, route.model, match),
      tier: 'direct',
      reason: 'direct',
    };
  }

  /* ── Attempts ────────────────────────────────────────────────────── */

  private startAttempt(
    ctx: IngestionContext,
    requestId: string,
    start: ProviderAttemptStart,
  ): ProviderAttemptRef {
    const startedAtMs = Date.now();
    const attempt: ProviderAttemptRef = {
      id: uuid(),
      attemptNumber: 1,
      startedAtMs,
      startedAt: new Date(startedAtMs).toISOString(),
      pendingWrite: Promise.resolve(false),
    };
    attempt.pendingWrite = this.recorder
      .recordPendingProviderAttempt(ctx, requestId, attempt, start)
      .catch((e) => {
        this.logger.warn(`Failed to record pending audio Attempt: ${e}`);
        return false;
      });
    attempt.completeFailure = ({ status, errorBody, superseded }) =>
      this.recorder
        .completePendingProviderFailure(attempt, status, errorBody, superseded)
        .catch((e) => this.logger.warn(`Failed to complete audio Attempt: ${e}`));
    return attempt;
  }

  /* ── Task persistence ────────────────────────────────────────────── */

  private async attachAudioTask(
    requestId: string,
    taskId: string,
    stored: StoredAudioTask,
  ): Promise<void> {
    await this.requestRepo.update(
      { id: requestId },
      {
        audio_task_id: taskId,
        audio_result: stored as object,
        request_params: { duration: stored.result.duration },
      },
    );
  }

  /* ── Failures ────────────────────────────────────────────────────── */

  private async recordManifestFailure(
    err: unknown,
    info: {
      ctx: IngestionContext;
      requestId: string;
      traceId?: string;
      callerAttribution: CallerAttribution | null;
      requestHeaders: Record<string, string> | null;
      apiMode: AudioApiMode;
      startedAt: number;
    },
  ): Promise<AudioCallResult> {
    const status =
      err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code: ManifestErrorCode = err instanceof ManifestError ? err.code : 'M500';
    const message = err instanceof ManifestError ? err.message : formatManifestError(code);
    this.logger.warn(`Audio request blocked: ${code} status=${status}`);

    if (isRecordableManifestCode(code)) {
      await this.recorder
        .recordManifestBlockedRequest(info.ctx, {
          requestId: info.requestId,
          httpStatus: status,
          errorMessage: message,
          errorCode: code,
          reason: MANIFEST_CODE_TO_REASON[code],
          traceId: info.traceId,
          callerAttribution: info.callerAttribution,
          requestHeaders: info.requestHeaders,
          durationMs: Date.now() - info.startedAt,
          apiMode: info.apiMode,
        })
        .catch((e) => this.logger.warn(`Failed to record blocked audio request: ${e}`));
    }

    return { status, body: { error: { message, type: errorTypeForStatus(status) } } };
  }

  private credentialDeps() {
    return {
      providerKeyService: this.providerKeyService,
      oauth: {
        openaiOauth: this.openaiOauth,
        minimaxOauth: this.minimaxOauth,
        anthropicOauth: this.anthropicOauth,
        geminiOauth: this.geminiOauth,
        kiroOauth: this.kiroOauth,
        xaiOauth: this.xaiOauth,
      },
    };
  }
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function requestedModelOf(body: Record<string, unknown>): string | undefined {
  const model = body.model;
  return typeof model === 'string' && model.length > 0 ? model : undefined;
}

/**
 * Discovery annotates Whisper models with audio endpoints. The curated Groq
 * catalog is a fallback for a connection whose cached models predate that
 * annotation, so a freshly added key can still use the audio endpoints.
 */
function supportedAudioEndpoints(
  provider: string,
  model: string,
  match: DiscoveredModel | undefined,
): readonly string[] {
  if (match?.supportedEndpoints?.length) return match.supportedEndpoints;
  if (provider.toLowerCase() === 'groq') {
    const entry = GROQ_TRANSCRIPTION_MODEL_BY_ID.get(model);
    if (entry) {
      return [
        ...(entry.transcription ? [AUDIO_TRANSCRIPTION_ENDPOINT] : []),
        ...(entry.translation ? [AUDIO_TRANSLATION_ENDPOINT] : []),
      ];
    }
  }
  return [];
}

function toTaskObject(id: string, stored: StoredAudioTask) {
  return {
    id,
    object: stored.apiMode === 'transcriptions' ? 'audio.transcription' : 'audio.translation',
    status: 'completed' as const,
    created_at: stored.createdAt,
    model: stored.model,
    api_mode: stored.apiMode,
    result: stored.result,
    error: null,
  };
}

function asStoredTask(value: unknown): StoredAudioTask | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['model'] !== 'string' || !record['result']) return undefined;
  const result = record['result'] as TranscriptionResult;
  if (typeof result.text !== 'string') return undefined;
  return {
    model: record['model'],
    apiMode:
      record['apiMode'] === 'translations' || record['apiMode'] === 'transcriptions'
        ? record['apiMode']
        : 'transcriptions',
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
    result,
  };
}

function errorTypeForStatus(status: number): string {
  if (status >= 500) return 'server_error';
  return 'invalid_request_error';
}

function errorEnvelope(status: number, body: unknown): unknown {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  if (record && typeof record.error === 'object' && record.error !== null) return body;
  const message =
    record && typeof record.error === 'string'
      ? record.error
      : typeof body === 'string' && body.length > 0
        ? body
        : 'Audio provider request failed';
  return { error: { message, type: errorTypeForStatus(status) } };
}

function stringifyError(body: unknown): string {
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function extractTraceId(headers: IncomingHttpHeaders): string | undefined {
  const header = headers['traceparent'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const parts = value.split('-');
  return parts.length >= 2 ? parts[1] : undefined;
}

function extractSessionKey(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers['x-session-key'] ?? headers['x-opencode-session'] ?? headers['x-session-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
