---
'manifest': patch
---

**Route OpenAI Codex, `-pro`, `o1-pro`, and deep-research models to `/v1/responses` for API-key users.** Closes #1660.

OpenAI's `gpt-5.3-codex`, `gpt-5-codex`, `gpt-5.1-codex*`, `gpt-5.2-codex`, `gpt-5-pro`, `gpt-5.2-pro`, `o1-pro`, and `o4-mini-deep-research` only accept `api.openai.com/v1/responses` — they return HTTP 400 "not a chat model" on `/v1/chat/completions`. Manifest's subscription path already routed these correctly via the ChatGPT Codex backend, but API-key users always hit `/v1/chat/completions` and failed. Prod telemetry: 31 distinct users attempting Codex on API keys over the last 90 days, 36% error rate, one user stuck in a 1,400-call retry loop at 98% failure.

- New `openai-responses` provider endpoint targeting `api.openai.com/v1/responses`, reusing the existing `chatgpt` format (same `toResponsesRequest` / `convertChatGptResponse` converters used by the subscription path — just with a plain `Authorization: Bearer` header instead of the Codex-CLI masquerade).
- `ProviderClient.resolveEndpoint` swaps `openai` → `openai-responses` at forward time for any model matching the Responses-only regex. Subscription OAuth still routes to `openai-subscription` as before; custom endpoints are never overridden.
- Model discovery no longer drops Codex/-pro/o1-pro/deep-research — they're kept so users can select them and the proxy routes them transparently. `gpt-image-*` is moved to the non-chat filter (it was only incidentally caught by the old Responses-only filter; it's image generation, not a chat model).
- `OPENAI_RESPONSES_ONLY_RE` moved to `common/constants/openai-models.ts` with a shared `stripVendorPrefix` helper, so discovery and the proxy read the same source of truth without cross-module coupling.
