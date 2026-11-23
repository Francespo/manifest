---
'manifest': minor
---

Per-model US egress for OpenCode Go/Zen.

- Add `model_egress_policies`, a tenant-scoped per-model policy that routes only the selected models through the US gateway. Missing rows mean "auto": Crouton Alpha defaults to US, Muse Spark (and everything else) defaults to direct.
- Add a Model egress panel to the provider connection detail with search, per-model switches, and a gateway health badge; the model picker shows a compact `US` badge.
- Fix the OpenCode Go docs catalog URL and endpoint parser for the current `/inference/go/{openai,anthropic}/...` docs.
- Add `GET /api/v1/providers/:provider/models`, `PATCH /api/v1/providers/:provider/models/egress`, and `GET /api/v1/providers/us-egress/health`.
