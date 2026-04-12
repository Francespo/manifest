---
"manifest": patch
---

Deprecate the self-hosted `manifest` plugin. The embedded-server plugin is no longer maintained — use the Docker image instead (`docker compose -f docker/docker-compose.yml up -d`). Existing installations keep working but now print a deprecation warning at startup. The plugin README is now checked into the repo directly instead of being overwritten from the root README at publish time.
