---
"manifest": major
---

Drop the legacy routing identity columns from `tier_assignments`, `specificity_assignments`, and `header_tiers`. The structured `route` shape introduced in #1772 is now the only persistence form.

Schema: 13 columns dropped (`override_model`, `override_provider`, `override_auth_type`, `fallback_models` from all three tables; `auto_assigned_model` from tier and specificity tables). Migration `1784000000000-DropLegacyRoutingColumns` runs on boot. `down()` re-adds the columns nullable but data is one-way lost — backup before upgrading if you maintain a hot-standby.

API breaking change: `POST /api/v1/routing/resolve` no longer returns the flat `model`, `provider`, `auth_type`, `fallback_models` fields. External callers must read `route.model`, `route.provider`, `route.authType`, and `fallback_routes` instead.

Internals: removes the legacy inference cascade in `proxy-fallback.service.ts`, the dual-write paths in routing services, and the `?? legacy` reads throughout. Same model name on different auth types stays correctly distinct (the #1708 fix).
