import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIO_TRANSCRIPTION_ENDPOINT,
  AUDIO_TRANSLATION_ENDPOINT,
  GROQ_AUDIO_BASE_URL,
  type AudioResponseFormat,
  type AudioSegment,
  type TranscriptionResult,
} from 'manifest-shared';
import { PROVIDER_ENDPOINTS } from '../proxy/provider-endpoints';
import type { AudioRequestFields, AudioUpload } from './audio-validation';

/** The audio surfaces Manifest exposes. Mirrors the audio members of ProxyApiMode. */
export type AudioApiMode = 'transcriptions' | 'translations';

const AUDIO_TIMEOUT_MS = 300_000;

/**
 * Base URL for the audio endpoints. Groq has a dedicated constant (and env
 * override for self-hosted gateways); every other OpenAI-compatible provider
 * reuses the chat endpoint's base URL with `/v1` appended.
 */
function baseUrlForProvider(provider: string): string | undefined {
  if (provider === 'groq') {
    return (process.env['GROQ_AUDIO_BASE_URL']?.trim() || GROQ_AUDIO_BASE_URL).replace(/\/+$/, '');
  }
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint || endpoint.format !== 'openai') return undefined;
  return `${endpoint.baseUrl.replace(/\/+$/, '')}/v1`;
}

export interface AudioForwardOptions {
  provider: string;
  apiKey: string;
  model: string;
  apiMode: AudioApiMode;
  fields: AudioRequestFields;
  file?: AudioUpload;
  signal?: AbortSignal;
}

export interface AudioForwardResult {
  ok: boolean;
  status: number;
  /** The caller-facing body: transcript, plain text, or subtitles. */
  body: unknown;
  requestUrl: string;
  /** Provider-independent transcript, stored for the async task. */
  result?: TranscriptionResult;
  /** Audio duration in seconds, when the provider reported it. */
  seconds?: number;
  /** Human-readable failure for a non-ok response. */
  errorMessage?: string;
}

/**
 * Forwards speech-to-text to an OpenAI-compatible provider.
 *
 * Like MediaProviderClient, this deliberately does not use ProviderClient:
 * audio is a multipart endpoint, not a chat wire format. Routing, credentials,
 * recording, and pricing stay shared with the text proxy.
 *
 * Groq returns `duration` only in `verbose_json`, so the adapter always asks
 * upstream for that format and projects the answer back down to whatever the
 * caller requested. That keeps cost tracking truthful for every response
 * format, and srt/vtt are generated from the same timestamped segments.
 */
@Injectable()
export class AudioProviderClient {
  private readonly logger = new Logger(AudioProviderClient.name);

  async forward(opts: AudioForwardOptions): Promise<AudioForwardResult> {
    const provider = opts.provider.toLowerCase();
    const baseUrl = baseUrlForProvider(provider);
    const suffix = opts.apiMode === 'transcriptions' ? 'transcriptions' : 'translations';
    const expectedEndpoint =
      opts.apiMode === 'transcriptions' ? AUDIO_TRANSCRIPTION_ENDPOINT : AUDIO_TRANSLATION_ENDPOINT;
    if (!baseUrl) {
      return {
        ok: false,
        status: 400,
        body: {
          error: {
            message: `Provider "${provider}" does not expose ${expectedEndpoint}`,
            type: 'invalid_request_error',
          },
        },
        requestUrl: '',
        errorMessage: 'unsupported audio provider',
      };
    }

    const url = `${baseUrl}/audio/${suffix}`;
    const form = buildForm(opts);
    const headers = { Authorization: `Bearer ${opts.apiKey}` };

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), AUDIO_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Audio provider request failed: ${message}`);
      return {
        ok: false,
        status: 502,
        body: { error: { message: `Audio provider request failed: ${message}`, type: 'server_error' } },
        requestUrl: url,
        errorMessage: message,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
    }

    if (!response.ok) {
      const body = await parseBody(response);
      return {
        ok: false,
        status: response.status,
        body,
        requestUrl: url,
        errorMessage: extractErrorMessage(body),
      };
    }

    const upstream = await parseBody(response);
    const result = toTranscriptionResult(upstream);
    if (!result) {
      return {
        ok: false,
        status: 502,
        body: {
          error: { message: 'Audio provider returned an unrecognised response', type: 'server_error' },
        },
        requestUrl: url,
        errorMessage: 'unrecognised transcription response',
      };
    }

    return {
      ok: true,
      status: response.status,
      body: projectResult(result, opts.fields.responseFormat, upstream),
      requestUrl: url,
      result,
      seconds: result.duration,
    };
  }
}

/** Build the multipart body with the fields Groq/OpenAI expect. */
function buildForm(opts: AudioForwardOptions): FormData {
  const form = new FormData();
  if (opts.file) {
    const bytes = new Uint8Array(opts.file.buffer);
    const blob = new Blob([bytes], {
      type: opts.file.contentType || 'application/octet-stream',
    });
    form.append('file', blob, opts.file.filename || 'audio');
  } else if (opts.fields.url) {
    form.append('url', opts.fields.url);
  }
  form.append('model', opts.model);
  // Duration is only published in verbose_json. Ask for it unconditionally and
  // project back down to the caller's format after the fact.
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  // Translations always produce English; OpenAI's endpoint has no `language`.
  if (opts.apiMode === 'transcriptions' && opts.fields.language) {
    form.append('language', opts.fields.language);
  }
  if (opts.fields.prompt) form.append('prompt', opts.fields.prompt);
  if (opts.fields.temperature !== undefined) {
    form.append('temperature', String(opts.fields.temperature));
  }
  return form;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toTranscriptionResult(body: unknown): TranscriptionResult | undefined {
  const record = asRecord(body);
  if (!record) return undefined;
  const text = typeof record['text'] === 'string' ? record['text'] : undefined;
  if (text === undefined) return undefined;
  const segments: AudioSegment[] = [];
  if (Array.isArray(record['segments'])) {
    for (const raw of record['segments']) {
      const segment = asRecord(raw);
      if (!segment) continue;
      const start = numberField(segment['start']);
      const end = numberField(segment['end']);
      const segmentText = typeof segment['text'] === 'string' ? segment['text'] : undefined;
      if (start === undefined || end === undefined || segmentText === undefined) continue;
      segments.push({ start, end, text: segmentText });
    }
  }
  return {
    text,
    ...(numberField(record['duration']) !== undefined
      ? { duration: numberField(record['duration']) }
      : {}),
    ...(typeof record['language'] === 'string' ? { language: record['language'] } : {}),
    ...(segments.length > 0 ? { segments } : {}),
  };
}

/**
 * Convert the verbose transcript back to the OpenAI response format the
 * caller asked for. `verbose_json` returns the upstream payload unchanged so
 * clients still see provider-native fields they may rely on.
 */
function projectResult(
  result: TranscriptionResult,
  format: AudioResponseFormat,
  upstream: unknown,
): unknown {
  switch (format) {
    case 'text':
      return result.text;
    case 'json':
      return { text: result.text };
    case 'srt':
      return subtitles(result, 'srt');
    case 'vtt':
      return subtitles(result, 'vtt');
    case 'verbose_json':
      return upstream;
  }
}

function subtitles(result: TranscriptionResult, format: 'srt' | 'vtt'): string {
  const separator = format === 'vtt' ? '.' : ',';
  const cues = result.segments?.length
    ? result.segments.map(
        (segment) =>
          `${timestamp(segment.start, separator)} --> ${timestamp(segment.end, separator)}\n${segment.text.trim()}`,
      )
    : [
        `${timestamp(0, separator)} --> ${timestamp(result.duration ?? 0, separator)}\n${result.text.trim()}`,
      ];
  const blocks = cues.map((cue, index) => (format === 'srt' ? `${index + 1}\n${cue}` : cue));
  const body = blocks.join('\n\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}

function timestamp(seconds: number, separator: ',' | '.'): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis, 3)}`;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function extractErrorMessage(body: unknown): string | undefined {
  const record = asRecord(body);
  if (!record) return typeof body === 'string' ? body : undefined;
  const error = asRecord(record['error']);
  if (error && typeof error['message'] === 'string') return error['message'];
  if (typeof record['error'] === 'string') return record['error'];
  if (typeof record['detail'] === 'string') return record['detail'];
  return undefined;
}
