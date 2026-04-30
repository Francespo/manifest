---
"manifest": patch
---

Recreating an agent with a previously used name now produces a clean slate without losing the deleted agent's history. Agent deletion is soft (the row stays with `deleted_at` set, telemetry rows are preserved) and per-agent analytics scope to the live agent's id, so the new agent starts at zero while the old data remains queryable in storage.
