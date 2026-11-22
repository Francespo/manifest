# Speech-to-Text Routing (Transcriptions & Translations)

Manifest routes **text** through the chat proxy and **images/video** through the
media endpoints. This document adds the third surface: **speech-to-text**, with
Groq as the first provider.

> **Terminology** follows [`docs/glossary.md`](glossary.md): a **Manifest
> Request** is one logical request from an agent to Manifest (`requests`); a
> **Provider Attempt** is one request from Manifest to an AI provider
> (`agent_messages`).

## Decisions

| # | Decision | Choice |
| - | -------- | ------ |
| 1 | Integration | A dedicated `routing/audio` module, mirroring `routing/media`. Provider quirks live in `AudioProviderClient`; routing, credentials, recording and limits stay shared. |
| 2 | Public API | OpenAI-compatible `POST /v1/audio/transcriptions` and `POST /v1/audio/translations` (multipart). Accepted response formats: `json`, `text`, `srt`, `verbose_json`, `vtt`. |
| 3 | Routing | **Direct models + capability**. Whisper models are published in `/v1/models` with `supported_endpoints`, selected by `routeForOpenAiModelId`. No synthetic audio tiers, no new output modality (the transcript is text). |
| 4 | Polling | Optional. `X-Manifest-Async: true` on POST returns a task object; `GET /v1/audio/transcriptions/{id}` (or `/translations/{id}`) reads the stored transcript. Groq is synchronous, so the task is `completed` on POST — the surface exists so polling clients work unchanged with future async providers. |
| 5 | Cost | USD **per audio minute**, from a shared price table. Duration comes from `verbose_json`; Groq bills a 10-second minimum. Token columns stay `0`. Unknown duration/rate → `null`, never a fabricated zero. |

## What Groq exposes

| Endpoint | Wire | Models |
| -------- | ---- | ------ |
| `POST https://api.groq.com/openai/v1/audio/transcriptions` | multipart, synchronous | `whisper-large-v3-turbo`, `whisper-large-v3` |
| `POST https://api.groq.com/openai/v1/audio/translations` | multipart, synchronous | `whisper-large-v3` only |

List prices (console.groq.com/docs/models, Nov 2026): turbo **$0.04/audio-hour**,
large v3 **$0.111/audio-hour**, minimum billed length **10 s** per request.
Groq reports `duration` only in `verbose_json`, so the adapter always requests
that format upstream and projects the answer back to the caller's format. This
keeps cost tracking accurate for `json`, `text`, `srt` and `vtt` alike; subtitles
are generated from the same timestamped segments.

Groq is already a normal chat provider. Its `SharedProviderEntry` now carries
`transcription: { transcriptions: true, translations: true }`, which makes its
Whisper models bypass the non-chat discovery filters instead of being dropped
by `UNIVERSAL_NON_CHAT_RE` / the "must carry text in" rule.

## Architecture

```
POST /v1/audio/transcriptions        POST /v1/audio/translations
             │                                  │
             └───────────► AudioController ◄────┘  (AgentKeyAuthGuard, limits)
                                 │
                           AudioService
                ┌────────────────┼──────────────────┐
      catalog lookup       resolveRouteCredentials  ProxyMessageRecorder
      (publish id,                                  (Request + Attempt,
       capability gate)                              cost_usd, api_mode)
                                 │
                        AudioProviderClient
                 ┌───────────────┴────────────────┐
          Groq adapter                    generic OpenAI-compatible
          /audio/{transcriptions,translations}     adapter (chat base URL + /v1)
```

### Flow

1. `POST` arrives with `file` (multipart) or `url`. Multer parses the file into
   memory with a 25 MB default cap (`AUDIO_MAX_FILE_BYTES` overrides it).
2. A Manifest Request is recorded with `api_mode: transcriptions|translations`.
3. Plan request limit + tenant/IP rate limits are checked, sharing the text
   proxy's limiter.
4. The published model id is resolved with `routeForOpenAiModelId` against the
   agent's discovered models. An unknown id is M302.
5. **Capability gate**: the resolved model must advertise the endpoint being
   called (`supportedEndpoints`). A chat model on an audio endpoint is M304,
   before any credential or provider work.
6. Body validation is M304: missing file/url, oversized file, bad temperature,
   or Groq turbo on `/v1/audio/translations`.
7. Credentials come from `resolveRouteCredentials` (M100/M102), one Provider
   Attempt is recorded, and the multipart body is forwarded.
8. On success the transcript, duration and language are extracted. Cost is
   `rate_per_minute × max(duration, 10s)` and is written to
   `agent_messages.cost_usd` with zero tokens.
9. An async POST persists `audio_task_id` and the finished payload on the
   Manifest Request (migration `1803400000000-AddRequestAudioTask`) and returns
   a task object. GET reads it back locally — no second provider call, no
   second attempt — and finalizes cost if the create had no duration.

### Request shapes

Top-level multipart fields (`extra_body` is also flattened, as on media):

```jsonc
{
  "model": "groq/whisper-large-v3",
  "file": "<multipart audio>",   // or "url": "https://…/clip.mp3"
  "language": "it",              // transcriptions only
  "prompt": "Italian, punctuated",
  "temperature": 0.2,
  "response_format": "verbose_json"
}
```

The provider-qualified id published by `/v1/models` is accepted verbatim, as
are bare ids that resolve unambiguously.

### Model projection

`GET /v1/models?capabilities=true` publishes `supported_endpoints` on Whisper
models, so a client can tell a speech-to-text model from a chat model without
guessing from the name. `?cost=true` adds:

```jsonc
"audio_cost": { "unit": "minute", "rates": 0.00185, "minimum_billable_seconds": 10 }
```

Pure audio models carry no `context_window` / `max_output_tokens`.

## Tests

- `routing/audio/__tests__/audio-provider-client.spec.ts` — multipart shape,
  `verbose_json` extraction, format projection, errors, base-URL override.
- `routing/audio/__tests__/audio.service.spec.ts` — routing, capability gate,
  validation, cost, async persistence, task polling, provider failures.
- `routing/audio/__tests__/audio-pricing.spec.ts`, `audio-validation.spec.ts`.
- `model-discovery/groq-transcription-models.spec.ts` — annotation, curated
  catalog fallback, non-chat filter exemption.
- `shared/__tests__/audio.spec.ts` — endpoint constants, catalog, prices.

## Open questions

- Groq does not retain transcripts, so async GET is a local read. A provider
  with a true long-running job would need a provider poll in `taskStatus` —
  the stored task shape already leaves room for a `processing` status.
- Other STT providers (OpenAI, Deepgram, Mistral Voxtral) are not enabled yet;
  adding one means a `transcription` capability on its provider entry, a
  curated model catalog, a price table, and an adapter branch if its wire
  format differs from OpenAI's.
- The 25 MB upload cap matches Groq's free tier. Dev tiers allow 100 MB;
  self-hosters can raise `AUDIO_MAX_FILE_BYTES`.
- `attempt_recording` for multipart audio is not wired: the Request/Attempt
  rows, cost and attribution are recorded, but the raw audio payload is not.
