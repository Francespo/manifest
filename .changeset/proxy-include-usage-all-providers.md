---
"manifest": patch
---

Fix proxy recording 0 tokens and "—" cost for streaming requests against Mistral, Kimi (Moonshot), MiniMax, DeepSeek, Qwen, xAI, Z.AI, Copilot, OpenCode-Go, and custom OpenAI-compatible providers. The proxy now injects `stream_options.include_usage: true` for all OpenAI-format endpoints so usage data flows back from the upstream.

Also fix the cache-tokens column staying empty for the same providers: usage extraction now reads `prompt_tokens_details.cached_tokens` (DeepSeek, Z.AI, Mistral, MiniMax, OpenAI shape) in addition to the top-level `cache_read_tokens` and Anthropic-native `input_tokens_details.cached_tokens` keys.
