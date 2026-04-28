---
"manifest": patch
---

fix(dashboard): the OpenClaw setup snippet was generating a config with `api: 'openai-responses'`, but Manifest's cloud proxy speaks Chat Completions. OpenClaw rendered empty assistant bubbles even though tokens were billed correctly. Snippet now writes `api: 'openai-completions'` and the dashboard label reads "OpenAI Chat Completions-compatible". Existing OpenClaw users who pasted the broken snippet need to re-run the updated config block (or flip `models.providers.manifest.api` manually).
