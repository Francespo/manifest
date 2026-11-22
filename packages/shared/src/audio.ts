/**
 * Shared contracts for speech-to-text endpoints.
 *
 * Manifest exposes the OpenAI-compatible audio surface:
 *   POST /v1/audio/transcriptions   (audio → text in the source language)
 *   POST /v1/audio/translations     (audio → English text)
 *
 * Both are multipart requests and synchronous at Groq. The optional async
 * task surface (`X-Manifest-Async: true` on POST, then GET
 * /v1/audio/transcriptions/{id}) stores the finished transcript on the
 * Manifest Request; it exists so clients that prefer polling work the same
 * way with future asynchronous providers.
 *
 * Transcription models are *not* chat models. They are published in
 * `/v1/models` with `supported_endpoints` naming the audio endpoint, and
 * routed by that capability rather than by output modality (the output is
 * plain text).
 */

/** Manifest endpoints that serve speech-to-text. */
export const AUDIO_TRANSCRIPTION_ENDPOINT = '/v1/audio/transcriptions';
export const AUDIO_TRANSLATION_ENDPOINT = '/v1/audio/translations';

export const AUDIO_ENDPOINTS = [
  AUDIO_TRANSCRIPTION_ENDPOINT,
  AUDIO_TRANSLATION_ENDPOINT,
] as const;

export type AudioEndpoint = (typeof AUDIO_ENDPOINTS)[number];

export function isAudioEndpoint(value: unknown): value is AudioEndpoint {
  return typeof value === 'string' && (AUDIO_ENDPOINTS as readonly string[]).includes(value);
}

/** Response formats accepted by the OpenAI-compatible audio endpoints. */
export const AUDIO_RESPONSE_FORMATS = ['json', 'text', 'srt', 'verbose_json', 'vtt'] as const;
export type AudioResponseFormat = (typeof AUDIO_RESPONSE_FORMATS)[number];

export function isAudioResponseFormat(value: unknown): value is AudioResponseFormat {
  return (
    typeof value === 'string' && (AUDIO_RESPONSE_FORMATS as readonly string[]).includes(value)
  );
}

/** Canonical vocabulary for an audio task, mirroring VideoStatus. */
export const AUDIO_TASK_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export type AudioTaskStatus = (typeof AUDIO_TASK_STATUSES)[number];

/** One timestamped fragment of a transcript (Groq verbose_json segments). */
export interface AudioSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Provider-independent transcript. Callers asking for `text` receive only
 * `text`; `verbose_json` also receives duration, language and segments.
 */
export interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
  segments?: readonly AudioSegment[];
}

/**
 * Task object returned when the caller opts into the asynchronous surface.
 * For a synchronous provider the task is already `completed` on POST.
 */
export interface AudioTaskObject {
  id: string;
  object: 'audio.transcription' | 'audio.translation';
  status: AudioTaskStatus;
  created_at: number;
  model: string;
  /** Which POST created the task; GET /v1/audio/transcriptions/{id} serves both. */
  api_mode: 'transcriptions' | 'translations';
  /** Present on a completed task. */
  result?: TranscriptionResult;
  error?: { message: string } | null;
}

/* ── Provider catalogs ─────────────────────────────────────────────── */

/** Public Groq audio surface. Overridable in the backend with GROQ_AUDIO_BASE_URL. */
export const GROQ_AUDIO_BASE_URL = 'https://api.groq.com/openai/v1';

export interface TranscriptionModelEntry {
  /** Wire id accepted by the provider. */
  id: string;
  displayName: string;
  /** Whether the model accepts /v1/audio/transcriptions. */
  transcription: boolean;
  /** Whether the model accepts /v1/audio/translations. */
  translation: boolean;
}

/**
 * Groq's published speech-to-text catalog (console.groq.com/docs/speech-to-text).
 * Turbo is transcription-only; `whisper-large-v3` serves both endpoints.
 */
export const GROQ_TRANSCRIPTION_MODELS: readonly TranscriptionModelEntry[] = [
  { id: 'whisper-large-v3-turbo', displayName: 'Whisper Large v3 Turbo', transcription: true, translation: false },
  { id: 'whisper-large-v3', displayName: 'Whisper Large v3', transcription: true, translation: true },
];

export const GROQ_TRANSCRIPTION_MODEL_BY_ID: ReadonlyMap<string, TranscriptionModelEntry> = new Map(
  GROQ_TRANSCRIPTION_MODELS.map((model) => [model.id, model]),
);

/* ── Pricing ───────────────────────────────────────────────────────── */

/**
 * USD pricing for speech-to-text, keyed by provider. Unlike token pricing,
 * audio is billed on the duration of the uploaded file.
 */
export interface AudioPriceTable {
  /** USD per minute of audio for a given model. */
  audioPerMinute?: Readonly<Record<string, number>>;
  /** USD per minute for an unlisted model of this provider. */
  audioDefaultPerMinute?: number;
  /**
   * Providers may floor the billed duration. Groq bills at least 10 seconds
   * per request, so a 4-second clip costs the same as a 10-second clip.
   */
  minimumBillableSeconds?: number;
}

/**
 * Groq list prices (console.groq.com/docs/models, Nov 2026):
 *   whisper-large-v3-turbo $0.04 per audio hour  → $0.000666…/min
 *   whisper-large-v3       $0.111 per audio hour → $0.00185/min
 */
export const GROQ_AUDIO_PRICES: AudioPriceTable = {
  audioPerMinute: {
    'whisper-large-v3-turbo': 0.04 / 60,
    'whisper-large-v3': 0.111 / 60,
  },
  minimumBillableSeconds: 10,
};

/** Provider price tables, kept next to the provider catalogs that own them. */
export const PROVIDER_AUDIO_PRICES: Readonly<Record<string, AudioPriceTable>> = {
  groq: GROQ_AUDIO_PRICES,
};
