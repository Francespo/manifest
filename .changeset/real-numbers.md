---
"manifest": minor
---

Public usage API combines cloud and self-hosted message counts. The `/api/v1/public/usage` endpoint now adds the fleet-wide self-hosted total fetched from the peacock control plane (when `TELEMETRY_AGGREGATE_KEY` is configured) to the cloud count, falling back to cloud-only if peacock is unreachable.
