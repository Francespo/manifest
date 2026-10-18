---
'manifest': patch
---

Forward a genuine OpenCode caller's own identity to OpenCode Zen, and stop fabricating one for everybody else.

Zen serves its free model tier only to first-party OpenCode traffic, and it checks the request as a whole: the CLI's `User-Agent`, a well-formed `ses_…` session id, and a body carrying one of OpenCode's built-in system prompts. Zen is the authority on that check.

Manifest was overwriting the caller's session id with its own opaque `manifest-<hash>` affinity value. Chat requests to `opencode-zen` (including the dedicated Google and Muse Spark routes) now carry the caller's own `ses_…` id on `x-opencode-session`, `x-opencode-session-id`, `x-session-id`, and `x-session-affinity` whenever the caller presents an OpenCode identity _and_ a genuine session id — so a real OpenCode client keeps the identity Zen accepts, instead of losing it to Manifest's own value. The caller's own `x-opencode-project` header rides along with that same identity: it is read from the inbound request and threaded through to the provider forward.

Everything else is left untouched. Manifest no longer mints a session id, presents `User-Agent: opencode/<channel>/<version>/<name>`, sets `x-opencode-client`, or hashes a project id for callers that are not OpenCode, and the System One classifier call to `/zen/v1/systemone` now goes out as Manifest with only its own credential. A caller that does not bring an OpenCode identity gets Zen's refusal, which is the honest answer: the free tier is Zen's to grant and it grants it to its own client.

One consequence worth knowing: Zen's free classifier model (`opencode-zen/jev-1.13-free`) is first-party only and can now be refused on `/zen/v1/systemone`; the paid `opencode-zen/jev-1.13` is unaffected.
