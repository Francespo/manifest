---
"manifest": patch
---

Bump Docker runtime to Node 24 LTS (`gcr.io/distroless/nodejs24-debian13`). Active LTS through April 2028, replacing Node 22 (Maintenance LTS, EOL April 2027). Build and prod-deps stages move to `node:24-alpine` and `node:24-slim` to keep install and runtime majors aligned. CI and release workflows updated to Node 24. Dependabot is now pinned to ignore Node major bumps so non-LTS Current releases (Node 23, 25, 27…) won't open noisy PRs — LTS upgrades happen on a deliberate cadence.
