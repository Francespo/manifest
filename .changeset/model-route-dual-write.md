---
"manifest": minor
---

Routing identity is now backed by a structured `ModelRoute = (provider, authType, model)` shape stored alongside the existing legacy columns on `tier_assignments`, `specificity_assignments`, and `header_tiers`. Reads prefer the new shape and fall back to legacy, so existing rows keep working without intervention. Selecting the same model name under different auth types (e.g. `gpt-4o` on subscription and on api_key) is now correctly treated as two distinct routes — fixes #1708. The `/api/v1/routing/resolve` response gains additive `route` and `fallback_routes` fields without breaking the existing flat shape. Per-fallback-attempt `auth_type` is now recorded on `agent_messages` instead of inheriting the primary's. No UI, API contract, or data is removed in this release; legacy columns and fields stay populated for one cycle before being dropped in a follow-up.
