---
"manifest": patch
---

Fix deleted custom providers continuing to intercept every request (#1603). Specificity routing now validates that an override model is still available before using it, and deleting a custom provider now also clears orphan references in specificity assignments and fallback-model lists. A one-time migration cleans existing orphaned references from the database so previously affected agents recover automatically.
