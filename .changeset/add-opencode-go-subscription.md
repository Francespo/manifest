---
"manifest": minor
---

feat: add OpenCode Go as a subscription provider with dynamic model discovery

OpenCode Go is a low-cost subscription that exposes GLM, Kimi, MiMo, and MiniMax
models through a unified API. Users sign in at opencode.ai/auth, copy their API
key, and paste it into the OpenCode Go detail view in the routing UI. The backend
routes GLM/Kimi/MiMo models through the OpenAI-compatible endpoint and MiniMax
models through the Anthropic-compatible endpoint — both served from the same
`https://opencode.ai/zen/go` base URL. The Anthropic endpoint authenticates via
`x-api-key` (not Bearer), matching the native Anthropic wire protocol.

The model list is fetched dynamically from the public OpenCode Go docs source
and cached in memory for one hour, with a last-known-good fallback on fetch
failures. No hardcoded model list in the codebase.
