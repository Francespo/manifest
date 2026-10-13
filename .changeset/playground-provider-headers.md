---
'manifest': patch
---

Send provider-required request headers from the Playground. Runs against OpenCode Go and OpenCode Zen now carry `x-opencode-session`, so the provider no longer rejects them with `MissingSessionID`. Headers set in the request editor still take precedence.
