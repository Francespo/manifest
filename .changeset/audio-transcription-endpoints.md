---
'manifest': minor
---

Add OpenAI-compatible speech-to-text endpoints with Groq as the first provider.

- New `POST /v1/audio/transcriptions` and `POST /v1/audio/translations` multipart endpoints, routed through Manifest with the same per-tenant credentials, request limits, and Request/Attempt recording as text and media traffic.
- Groq Whisper models (`whisper-large-v3-turbo`, `whisper-large-v3`) are now published in `/v1/models` with `supported_endpoints` and per-minute `audio_cost`, instead of being filtered out as non-chat models.
- Responses project to `json`, `text`, `srt`, `verbose_json` or `vtt`; duration from `verbose_json` drives per-minute cost with Groq's 10-second billing floor.
- Optional `X-Manifest-Async: true` returns a pollable task; `GET /v1/audio/transcriptions/{id}` (or `/translations/{id}`) reads the stored transcript and finalizes cost.
