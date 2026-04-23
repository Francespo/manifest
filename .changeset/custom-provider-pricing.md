---
'manifest': patch
---

Fix cost column showing "—" for self-hosted custom provider messages. Prices entered via the custom provider form are now indexed into the shared pricing cache under `custom:<uuid>/<model>` — the same key the proxy writes to `agent_messages.model` — so the cost recorder can look them up when a request is routed. The cache refreshes immediately on create, model edits, and delete, so new prices take effect without waiting for the daily 5am reload. Custom entries are scoped out of the public `/api/v1/model-prices` list so one tenant's providers can't leak into another's. Existing messages recorded with `cost_usd = null` stay null (no price snapshot is stored per message); only new messages benefit.
