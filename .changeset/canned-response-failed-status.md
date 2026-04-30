---
"manifest": patch
---

Mark Manifest's canned setup-prompt and limit responses as Failed in the Messages list. Requests that hit `no_provider`, `no_provider_key`, `limit_exceeded`, or `friendly_error` (the `[🦚 Manifest] …` stubs) now show a red Failed badge with a tooltip explaining why, instead of an ambiguous green Success.
