---
"manifest": patch
---

Fix dashboard Recent Messages showing the complexity tier (e.g. `STANDARD`) instead of the specificity category (e.g. `CODING`) for messages routed by specificity. The Overview analytics endpoint now projects `specificity_category` alongside `routing_tier`, matching the full Messages log.
