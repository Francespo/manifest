---
"manifest": minor
---

Revert combined cloud + self-hosted message count on `/api/v1/public/usage`. The endpoint goes back to reporting cloud-only counts. The self-hosted aggregate fetcher and its `TELEMETRY_AGGREGATE_KEY` env var are removed.
