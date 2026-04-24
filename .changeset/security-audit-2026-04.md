---
'manifest': minor
---

Security hardening sweep (audit 2026-04-23):

- **Fix cross-tenant agent rename.** Rename cascades on `agent_messages` / `notification_rules` / `notification_logs` are now scoped by `tenant_id`, closing an IDOR that silently relabelled other tenants' telemetry when slugs collided.
- **Revalidate custom-provider base URLs at forward time.** Cloud mode re-runs `validatePublicUrl` on every proxy forward so a flipped-DNS-record can't point an existing provider at a private/metadata IP and receive the user's decrypted key. Custom-provider fetches also pass `redirect: 'error'` to refuse redirect-based SSRF.
- **Loopback auth derives from the socket peer, not `req.ip`.** Self-hosted deployments behind a reverse proxy with `trust proxy` no longer grant dashboard access when `X-Forwarded-For: 127.0.0.1` is forged.
- **Whitelist provider names on the agent-facing subscription endpoint** and silently skip non-subscription-capable providers on the token branch.
- Raise `minPasswordLength` to 12 (Better Auth + setup admin).
- Validate `BETTER_AUTH_URL` before interpolating into the OG-tag rewrite; strip non-ASCII characters from `X-Manifest-*` response headers and regex-validate custom-provider `model_name`.
- Enable `forbidNonWhitelisted` on the global ValidationPipe; use `SetFallbacksDto` in `SpecificityController`; gate Better Auth debug logs on `NODE_ENV`; prefer `app.betterAuthUrl` over `req.host` when starting the OpenAI OAuth flow.
- Decouple `MANIFEST_ENCRYPTION_KEY` from `BETTER_AUTH_SECRET` (fallback warns once).
- `SessionGuard` + `AgentKeyAuthGuard` share a tightened `isLoopbackIp` + new `isLoopbackRequest` helper.
- Refuse to seed demo data when `BIND_ADDRESS=0.0.0.0` and `NODE_ENV !== 'development'`.
- `npm audit fix` for the moderate `@nestjs/core` advisory.
