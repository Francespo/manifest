---
'manifest': patch
---

Shrink the Docker image by switching the runtime stage to distroless Node 22 (`gcr.io/distroless/nodejs22-debian12:nonroot`):

- Runtime drops the shell, `apk`, and the unused yarn toolchain that `node:22-alpine` bakes in.
- Production dependencies are now staged on `node:22-slim` so glibc matches the distroless debian12 runtime (all runtime deps are pure JS).
- Prune `sql.js` from the runtime node_modules — it's an optional TypeORM peer only used by the legacy SQLite local mode, which is never active in Docker.
- Add `--prefer-offline --no-audit --no-fund` to all npm installs, and pin the two new base images by digest.
- Result: `423MB → 362MB` on disk (−14.4%), `84.2MB → 71.9MB` compressed pull (−14.6%).
