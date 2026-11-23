---
'manifest': minor
---

Scoped model catalogs: clients can pick what `GET /v1/models` advertises by changing only their base URL.

- Every proxy route is mirrored under `/catalog/<variant>/v1` (`synthetic`, `synthetic-pool`, `synthetic-providers`). The URL still ends in `/v1`, so OpenAI- and Anthropic-style sdks keep their usual path conventions and swapping the base URL is the only client-side change. `/v1/models` stays exactly as before ("everything").
- `synthetic` publishes only the `auto` router and header-tier `auto-*` models; `synthetic-pool` adds a tenant-curated list of model ids; `synthetic-providers` adds every model from the tenant's selected hand-added (custom) providers.
- The tenant-wide selection is edited in Account → Model catalogs via the new session-authenticated `GET`/`PATCH /api/v1/model-catalog`. Choices are derived from the live catalog, so newly connected providers/models show up without a save.
- Only the advertised model list changes. Chat, responses, messages and media routing behind a scoped base URL are identical to the default routes; a model outside a scoped catalog is not blocked.
