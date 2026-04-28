---
"manifest": patch
---

Backend hot-path and dashboard query optimization pass: 60s LRU session cache in SessionGuard, slimmed AgentKeyAuthGuard query with 30min cache, retuned specificity miscategorization index, batched proxy fallback inserts, merged agent-list stats+sparkline into a single query, bounded distinct-models scan to 90 days, plus typed SSE events so dashboard pages only refetch on relevant changes instead of every ingest ping.
