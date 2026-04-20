---
'manifest': minor
---

Connect the Dockerized self-hosted version to local LLM servers on the host. The bundled `--profile ollama` service is gone; the Manifest container now reaches host-installed Ollama, vLLM, LM Studio, llama.cpp, text-generation-webui, and any OpenAI-compatible server at `host.docker.internal:<port>` via a `host-gateway` alias. Custom providers accept `http://` and private/loopback URLs in the self-hosted version (cloud metadata endpoints stay blocked). Adds preset chips for local servers and a server-side `/v1/models` probe that auto-populates the model list. Renames the deployment concept from "local" to "self-hosted" across the codebase (`MANIFEST_MODE=selfhosted`, `isSelfHosted()`); `MANIFEST_MODE=local` is still honored as a legacy alias.
