---
"manifest": minor
---

Capture incoming request headers on every proxied chat completion and surface them in the message detail drawer, with a new App/SDK meta row sourced from the existing caller attribution. Sensitive headers (authorization, cookie, proxy-authorization, x-api-key) are stripped before storage, and the Request Headers section is collapsed by default.
