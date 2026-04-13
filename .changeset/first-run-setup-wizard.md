---
---

Replace the hardcoded `admin@manifest.build` / `manifest` seed credentials with a first-run setup wizard. On fresh installs, visiting any route redirects to `/setup`, where the operator creates the first admin account with their own email and password. The wizard is backed by `POST /api/v1/setup/admin` which uses a Postgres advisory lock to prevent race-creation of multiple admins, marks the new user as `emailVerified = true` so it can log in immediately regardless of email configuration, and 409s once any user exists.

Self-hosted Docker Compose now ships with `NODE_ENV=production` and `SEED_DATA=false`, so the setup wizard is the only supported onboarding path. The dev/test seeder (`SEED_DATA=true` under `NODE_ENV=development|test`) still seeds `admin@manifest.build` for `/serve` and E2E fixtures. In production, `SEED_DATA=true` is explicitly ignored with a warning log directing operators to the setup wizard.
