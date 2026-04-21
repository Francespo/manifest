---
'manifest': minor
---

**Breaking change**: default port moves from `3001` to `2099`. The number nods to the peacock that is Manifest's logo. Anything hardcoding `http://localhost:3001` (reverse-proxy configs, OAuth callback URLs, bookmarks, OpenClaw provider configs, scripts) needs to be updated. The Docker compose file, `.env.example`, install script, and backend default all move in lockstep, so a fresh `install.sh` run just works.

**Install script UX** (closes #1643):

- Default install directory is now `$HOME/manifest` (was `./manifest`), so the one-liner from `install.sh` no longer litters whatever directory you happened to run it in.
- The confirmation prompt now reads from `/dev/tty` when stdin is not a terminal (typical when piping `curl | bash` or running via process substitution). If there is no terminal at all, the script exits with a clear message pointing to `--yes`.
- Detects port conflicts up front: if `2099` is already bound, the installer aborts with a pointer to edit `docker-compose.yml`, instead of letting `docker compose up` fail with a less obvious message.
- Updated copy: "up to a couple of minutes" instead of "about 30 seconds" (the installer itself waits up to 120s).
- Prints a `curl -sSf http://localhost:2099/api/v1/health` smoke-test line alongside the dashboard URL on success.
- README now documents `--dir`, `--yes`, `--dry-run` and shows the review-then-run idiom for security-cautious users.

**Housekeeping**:

- Rename `packages/backend/src/common/utils/sql-dialect.ts` → `postgres-sql.ts`. The file only emits Postgres SQL (no dialect switching), so the old name was misleading. 20 import sites updated.
