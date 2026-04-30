---
"manifest": patch
---

Fix two routing regressions caused by agent-wrapped user messages. Strip leading metadata envelopes (e.g. `Sender (untrusted metadata):` blocks emitted by OpenClaw, NanoBot, Hermes) before scoring so simple greetings like "say hello" no longer route to standard/complex (#1766). Tighten coding specificity signals so generic agent tools (`read`, `write`, `edit`, `bash`, etc.) and tiny envelope code fences no longer hijack every prompt to the coding tier (#1767).
