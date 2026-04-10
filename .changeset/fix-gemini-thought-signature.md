---
"manifest": patch
---

Fix Gemini 3 tool calling by round-tripping `thoughtSignature` correctly.

The Google adapter was reading and writing `thought_signature` (snake_case, inside the `functionCall` object), but Google's actual wire format is `thoughtSignature` (camelCase, at the Part level, as a sibling of `functionCall`). Signatures were therefore never extracted from Gemini responses and never re-injected into follow-up requests. Gemini 3 made these signatures mandatory for tool-use follow-ups, surfacing the bug as `HTTP 400: Function call is missing a thought_signature in functionCall parts`. Gemini 2.5 Pro and 2.5 Flash were silently affected too, losing reasoning context across tool-call turns.

- Parse `thoughtSignature` from the Part level in both streaming and non-streaming Google responses
- Re-inject cached signatures as a Part-level `thoughtSignature` field when building follow-up requests
- Drop `thought: true` reasoning-summary text parts from assistant content (previously leaked into replies)
- Replace the regex-on-transformed-output signature extraction in the stream handler with a structured return value from the adapter
