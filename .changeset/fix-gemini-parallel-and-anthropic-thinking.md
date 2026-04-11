---
"manifest": patch
---

Fix three provider-adapter round-trip bugs discovered while shipping the Gemini 3 thoughtSignature fix.

**Gemini parallel tool calling.** `fromGoogleResponse` and the streaming adapter now preserve Google's own `functionCall.id` (e.g. `"4z1aadbn"`) instead of generating a synthetic `call_<uuid>`. Without this, parallel tool calls could not be correlated back to their originating calls on the follow-up turn, because Google pairs responses by id, not position.

**Gemini `functionResponse` name mapping.** `toGoogleRequest` now scans the assistant tool_calls history and resolves `functionResponse.name` from the originating function name (instead of stuffing the tool_call_id into the `name` field). It also emits `functionResponse.id` mirroring the tool_call_id so parallel-call pairing is unambiguous end-to-end. Gemini 2.x tolerated the old behavior; Gemini 3 tightens the contract.

**Anthropic extended-thinking round-trip.** New `ThinkingBlockCache` (mirrors `ThoughtSignatureCache`). `fromAnthropicResponse` extracts `thinking` and `redacted_thinking` blocks alongside tool_use blocks; the stateful stream transformer assembles them during streaming and flushes at `message_delta` (so late-arriving signature deltas can't corrupt the snapshot); `toAnthropicRequest` re-injects cached blocks before `tool_use` on the next turn. Without this, Claude 4.x with extended thinking + tools was returning HTTP 400 on any follow-up turn — "assistant messages that include tool_use content blocks must also include unmodified thinking or redacted_thinking blocks that preceded the tool use".

Verified end-to-end against the live Gemini 3 Pro Preview API with a parallel tool-call scenario (weather in Paris + Tokyo, tool responses sent in reversed order): HTTP 200 with both tool results correctly attributed.
