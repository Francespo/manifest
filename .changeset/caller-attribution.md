---
"manifest": minor
---

feat: capture caller attribution from proxy requests and surface it in a new Callers page

Every request to `/v1/chat/completions` now has its HTTP headers classified into a
`caller_attribution` JSONB field on the agent message. The classifier understands the
OpenRouter convention (`HTTP-Referer`, `X-OpenRouter-Title` / `X-Title`,
`X-OpenRouter-Categories`) as well as Stainless-generated SDK fingerprints
(`x-stainless-lang`, `x-stainless-package-version`, runtime / os / arch) used by the
official OpenAI and Anthropic SDKs, plus common raw clients like `curl`, `python-requests`,
`node-fetch` and `axios`. Values are sanitised (control chars stripped, capped length) and
the referer is normalised to its origin.

A new `GET /api/v1/callers` endpoint aggregates the data by app name, app URL, and SDK,
returning per-caller token/cost totals and an overall attribution rate. A matching Callers
page is added to the agent sidebar.
