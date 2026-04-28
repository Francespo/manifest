---
"manifest": patch
---

Security audit fixes (OWASP review).

- Auth: SessionGuard and AgentKeyAuthGuard now read `request.socket.remoteAddress` for the loopback bypass decision instead of `request.ip`, which is forgeable via `X-Forwarded-For` when `trust proxy` is enabled. The production `trust proxy` setting is narrowed to `loopback, linklocal, uniquelocal` (override with `TRUST_PROXY` env).
- Proxy: custom-provider and subscription endpoint URLs are revalidated against the SSRF allowlist immediately before each forward (DNS-rebinding defense). All proxy `fetch()` calls now use `redirect: 'error'` to block redirect-based escalation.
- Auth rate limiting: added per-endpoint limits for `sign-up`, `forget-password` / `forgot-password` / `reset-password`, and `verify-email` / `send-verification-email` (Better Auth runs outside NestJS so `ThrottlerGuard` doesn't apply).
- ApiKeyGuard: DB-API-key path now populates `request.user`, so user-scoped controllers no longer crash with a 500. `@CurrentUser()` fails closed with a 401 when no user is attached.
- Crypto: AES-GCM IV length set to the standard 12 bytes (was 16), scrypt-derived keys cached per (secret, salt) to remove the per-call ~50ms cost on the proxy hot path. Boots warns once when `MANIFEST_ENCRYPTION_KEY` falls back to `BETTER_AUTH_SECRET` in production.
- OAuth: `backendUrl` is validated against the allowlist at storage time instead of being trusted on the way out.
- Telemetry: `routing_tier` and `auth_type` buckets are whitelisted against the shared enums; unknown values collapse to `"other"` instead of leaking verbatim.
- Frontend: 401 responses no longer force a redirect to `/login` for per-endpoint auth failures. Only session-shaped 401s log the user out.
- HSTS: warns at boot when production runs without HSTS on a non-loopback bind. Silence with `MANIFEST_DISABLE_HSTS=1`.
- Dev CORS: defaults to a single origin (`http://localhost:3000`); set `CORS_ORIGIN` for anything else.
