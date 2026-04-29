---
"manifest": patch
---

Strip `reasoning_details` from message history before forwarding to non-OpenRouter providers. Mistral, Groq, and other strict OpenAI-compatible providers were rejecting requests with `extra_forbidden` (422) when conversations contained extended-thinking blocks from a prior turn.
