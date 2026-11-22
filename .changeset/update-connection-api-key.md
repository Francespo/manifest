---
'manifest': patch
---

Allow replacing a connection's API key or subscription token without deleting and recreating the connection. Adds a tenant-scoped `PATCH /api/v1/providers/:provider/keys/:label/key` endpoint that rotates the encrypted credential, refreshes its prefix and model catalog in place, and preserves the connection's identity, label, priority, per-agent enablement and usage history. The connection detail page now exposes a "Change key" control in the Manage dialog for usage-based and subscription connections.
