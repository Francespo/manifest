---
"manifest": patch
---

Fix: detect Podman and Kubernetes as self-hosted runtimes. Manifest now reads `/run/.containerenv` (Podman) and `KUBERNETES_SERVICE_HOST` in addition to `/.dockerenv`, so rootless Podman and Kubernetes installs no longer fall back to cloud-mode SSRF rules and reject `http://` URLs to local LLM servers.

Also narrows the cloud-metadata SSRF block to the actual IMDS addresses (`169.254.169.254`, `169.254.169.253`, `100.100.100.200`, `fd00:ec2::254`) instead of the entire `169.254.0.0/16` link-local range, so self-hosted users can reach `host.containers.internal` (which Podman maps to `169.254.x.y` under pasta/slirp4netns). Cloud mode is unchanged: link-local space is still rejected via the private-IP guard.
