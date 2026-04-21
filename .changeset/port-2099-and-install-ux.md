---
'manifest': minor
---

New Docker installs get port **2099** (a nod to the peacock logo) by default. Existing installs keep their current port — no action required on upgrade.

### How backward compatibility is preserved

- The backend's own fallback stays at `3001` (it's `process.env.PORT ?? 3001` everywhere).
- The Docker Compose file now sets `PORT=${PORT:-2099}` explicitly. New installs from `install.sh` get 2099 end-to-end: backend listens on 2099, compose binds `127.0.0.1:2099:2099`, and `BETTER_AUTH_URL` defaults to `http://localhost:2099`.
- Existing installs that pull the new image against their unchanged compose file continue to work: no `PORT` env, so the backend falls back to 3001, their old `127.0.0.1:3001:3001` binding still matches, and their `BETTER_AUTH_URL` / reverse proxy / OAuth callbacks all keep working.
- If a user wants to upgrade their compose file but keep port 3001 (e.g., to avoid reconfiguring OAuth callbacks), they set `PORT=3001` in `.env` and the compose file honours it — both the host binding and the internal listener now read `${PORT:-2099}`.
- The Dockerfile `HEALTHCHECK` reads `process.env.PORT || 3001` at runtime so it follows whatever port the backend is actually listening on, regardless of which image-version pairs with which compose file.

### Install script UX (closes #1643)

- Default install directory is now `$HOME/manifest` (was `./manifest`), so the one-liner from `install.sh` no longer litters whatever directory you happened to run it in.
- The confirmation prompt reads from `/dev/tty` when stdin is not a terminal (typical when piping `curl | bash` or running via `bash <(curl ...)`). If there is no terminal at all, the script exits with a clear message pointing at `--yes`.
- Detects port conflicts up front: if `2099` is already bound, the installer aborts with a pointer to edit `docker-compose.yml`, instead of letting `docker compose up` fail with a less obvious message.
- Copy fix: "up to a couple of minutes" instead of "about 30 seconds" (the installer itself waits up to 120s).
- Prints a `curl -sSf http://localhost:2099/api/v1/health` smoke-test line alongside the dashboard URL on success.
- README now documents `--dir`, `--yes`, `--dry-run` and shows the review-then-run idiom for security-cautious users.

### Housekeeping

- Rename `packages/backend/src/common/utils/sql-dialect.ts` → `postgres-sql.ts`. The file only emits Postgres SQL (no dialect switching), so the old name was misleading. 20 import sites updated.
