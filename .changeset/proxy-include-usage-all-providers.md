---
"manifest": patch
---

Fix proxy recording 0 tokens and "—" cost for streaming requests against Mistral, Kimi (Moonshot), MiniMax, DeepSeek, Qwen, xAI, Z.AI, Copilot, OpenCode-Go, and custom OpenAI-compatible providers. The proxy now injects `stream_options.include_usage: true` for all OpenAI-format endpoints so usage data flows back from the upstream.
