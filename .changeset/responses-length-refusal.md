---
'manifest': patch
---

Keep token-limited and refused replies visible on `/v1/responses` when the upstream speaks Chat Completions. A `length` or `content_filter` finish now yields `status: "incomplete"` (streams end with `response.incomplete`), and `message.refusal` / `delta.refusal` become `refusal` content parts instead of an empty completed response. Non-stream requests answered by a native Responses upstream over SSE now keep the `response.incomplete` and `response.failed` snapshots instead of reporting them as completed.
