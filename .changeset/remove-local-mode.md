---
"manifest": patch
---

Remove local mode and harden the Docker deployment.

Manifest now runs exclusively on PostgreSQL with Better Auth. The self-contained `manifest` OpenClaw plugin (embedded Nest server, SQLite via sql.js, loopback-trust auth) is deprecated and removed from the repository — it will receive no further releases. Self-hosted users should use the Docker image (`manifestdotbuild/manifest`) with the bundled Postgres container via `docker/docker-compose.yml`, or the cloud version at app.manifest.build.

Docker deployments now default to `NODE_ENV=production`, with migrations controlled by a new `AUTO_MIGRATE=true` env var instead of the previous `NODE_ENV=development` workaround. Production-mode defaults activate: `trust proxy` for reverse-proxied deployments, sanitized upstream error messages, no "Dev" badge in the header, and email verification enforcement when a provider is configured. Self-hosters upgrading must set `BETTER_AUTH_SECRET` via `docker/.env` — the compose file no longer ships a placeholder secret.

New unified `EMAIL_*` env var scheme (`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_DOMAIN`, `EMAIL_FROM`) covers both Better Auth transactional emails (signup verification, password reset) and threshold alert notifications. Supports Resend (recommended for self-hosting — no domain setup), Mailgun, and SendGrid. Legacy `MAILGUN_*` env vars still work for backward compatibility.

Breaking: `MANIFEST_MODE`, `MANIFEST_DB_PATH`, `MANIFEST_UPDATE_CHECK_OPTOUT`, `MANIFEST_TRUST_LAN` env vars are removed (no-op if set). Both the `manifest` and `manifest-model-router` npm packages are deprecated — OpenClaw users should configure Manifest as a generic OpenAI-compatible provider instead (see the setup modal in the dashboard).
