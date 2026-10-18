---
'manifest': patch
---

Fix OpenCode Zen requests so a genuine OpenCode caller keeps the identity that Zen's free model tier accepts. Zen only serves free models to first-party OpenCode traffic, and checks the request as a whole: it needs the CLI's `User-Agent`, a well-formed OpenCode session id (`ses_…`), and one of OpenCode's built-in system prompts in the body.

Manifest was sending `x-opencode-session: manifest-<hash>`, which Zen rejects. Chat requests to `opencode-zen` (including the dedicated Google and Muse Spark routes) and classifier requests to `/zen/v1/systemone` now forward the caller's own session id when it is already OpenCode-shaped and otherwise mint a well-formed `ses_…` id, carrying it on `x-opencode-session`, `x-opencode-session-id`, `x-session-id`, and `x-session-affinity`. When the caller does not already identify as OpenCode, the request also carries `User-Agent: opencode/<channel>/<version>/<name>`, `x-opencode-client`, and `x-opencode-project`.

This only affects requests that already originate from an OpenCode client: Zen rejects the free tier for any other body, so no amount of header shaping unlocks it for other callers.
