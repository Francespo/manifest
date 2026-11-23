import {
  AUDIO_TRANSLATION_ENDPOINT,
  isAudioResponseFormat,
  type AudioResponseFormat,
} from 'manifest-shared';

function rawResponseFormat(body: Record<string, unknown>): unknown {
  const extra = body['extra_body'];
  const wrapper =
    extra && typeof extra === 'object' && !Array.isArray(extra)
      ? (extra as Record<string, unknown>)
      : {};
  return body['response_format'] ?? wrapper['response_format'];
}

/** The subset of OpenAI's audio form fields Manifest forwards upstream. */
export interface AudioRequestFields {
  language?: string;
  prompt?: string;
  temperature?: number;
  responseFormat: AudioResponseFormat;
  /** Groq accepts a URL instead of an uploaded file. */
  url?: string;
}

/** Multer's in-memory file, described structurally to avoid a multer type dep. */
export interface AudioUpload {
  buffer: Buffer;
  size: number;
  filename: string;
  contentType: string;
}

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Groq's free tier caps uploads at 25 MB; self-hosters can raise the limit. */
export function maxAudioFileBytes(): number {
  const raw = process.env['AUDIO_MAX_FILE_BYTES']?.trim();
  if (!raw) return DEFAULT_MAX_FILE_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FILE_BYTES;
}

function scalar(body: Record<string, unknown>, key: string): string | undefined {
  const raw = body[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * Flatten the optional `extra_body` wrapper (as media does) and parse the
 * fields that arrive as strings over multipart. Unknown fields are ignored:
 * providers like Groq reject unrecognised form parts with a 400.
 */
export function audioFieldsFromBody(body: Record<string, unknown>): AudioRequestFields {
  const extra = body['extra_body'];
  let wrapper: Record<string, unknown> = {};
  if (typeof extra === 'string') {
    try {
      const parsed: unknown = JSON.parse(extra);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        wrapper = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed extra_body is ignored rather than becoming a provider error.
    }
  } else if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    wrapper = extra as Record<string, unknown>;
  }
  const value = (key: string): unknown => body[key] ?? wrapper[key];
  const rawFormat = value('response_format');
  const responseFormat: AudioResponseFormat = isAudioResponseFormat(rawFormat)
    ? rawFormat
    : 'json';
  const rawTemperature = value('temperature');
  const parsedTemperature =
    typeof rawTemperature === 'number'
      ? rawTemperature
      : typeof rawTemperature === 'string' && rawTemperature.trim() !== ''
        ? Number(rawTemperature)
        : undefined;

  return {
    ...(scalar(body, 'language') ?? scalar(wrapper, 'language')
      ? { language: scalar(body, 'language') ?? scalar(wrapper, 'language') }
      : {}),
    ...(scalar(body, 'prompt') ?? scalar(wrapper, 'prompt')
      ? { prompt: scalar(body, 'prompt') ?? scalar(wrapper, 'prompt') }
      : {}),
    ...(parsedTemperature !== undefined && Number.isFinite(parsedTemperature)
      ? { temperature: parsedTemperature }
      : {}),
    ...(scalar(body, 'url') ?? scalar(wrapper, 'url')
      ? { url: scalar(body, 'url') ?? scalar(wrapper, 'url') }
      : {}),
    responseFormat,
  };
}

/**
 * Validate before any credential or provider work. An invalid audio body
 * becomes a documented M304 instead of a provider 400 that would count
 * against the provider's reliability statistics.
 */
export function validateAudioRequest(input: {
  provider: string;
  apiMode: 'transcriptions' | 'translations';
  model: string;
  body: Record<string, unknown>;
  file: AudioUpload | undefined;
  fields: AudioRequestFields;
}): string | undefined {
  const { provider, apiMode, model, file, fields } = input;
  if (typeof model !== 'string' || model.length === 0) return 'a model is required';
  if (!file?.buffer?.length && !fields.url) return 'an audio file or url is required';
  if (file && file.size > maxAudioFileBytes()) return 'the audio file is too large';
  const rawFormat = rawResponseFormat(input.body);
  if (rawFormat !== undefined && !isAudioResponseFormat(rawFormat)) {
    return 'unsupported response_format';
  }
  if (fields.temperature !== undefined && (fields.temperature < 0 || fields.temperature > 1)) {
    return 'temperature must be between 0 and 1';
  }
  // Groq's turbo model is transcription-only; fail locally with a clear reason
  // instead of surfacing an opaque upstream 400.
  if (
    apiMode === 'translations' &&
    provider === 'groq' &&
    model === 'whisper-large-v3-turbo'
  ) {
    return `${model} does not support ${AUDIO_TRANSLATION_ENDPOINT}`;
  }
  return undefined;
}
