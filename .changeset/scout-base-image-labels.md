---
"manifest": patch
---

Add `org.opencontainers.image.base.name` and `org.opencontainers.image.base.digest` OCI labels to the Docker image so Docker Scout can evaluate the "No unapproved base images" and "No outdated base images" policies.

The published image already ships SLSA provenance and SPDX SBOM attestations (the build workflow sets `sbom: true` and `provenance: mode=max`), but Scout's base-image policies key off the OCI base-image labels on the image config and buildkit does not auto-generate them. Without the labels, Scout reports "No data" for both policies and the image is stuck at a B health score even when it has no outstanding CVEs.

The labels sit next to the matching `FROM … AS runtime` line so a future base-image bump updates both together. No change to build output size, runtime behavior, or the attestation manifests — pure metadata addition on the image config.
