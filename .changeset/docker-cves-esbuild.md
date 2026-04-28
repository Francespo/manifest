---
"manifest": patch
---

Drop bundled `@esbuild/linux-x64` from the Docker image so CVE scanners no longer flag the embedded Go 1.23.12 stdlib (CVE-2025-68121 plus 10 high-severity CVEs). The binary was hoisted into the production `node_modules` despite `npm ci --omit=dev`; adding `--omit=optional` removes it along with other unused platform-specific binaries.
