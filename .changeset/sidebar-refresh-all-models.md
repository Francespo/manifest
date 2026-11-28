---
'manifest': minor
---

Refresh every connected provider's model catalog from one sidebar action, and keep catalogs fresh automatically.

- New **Refresh all models** button in the left sidebar under Providers calls the existing tenant-wide `POST /api/v1/providers/refresh-models`. It disables itself while running, shows a success toast, and leaves error toasts to the API client.
- New `ModelCatalogRefreshService` runs the same tenant-wide discovery at **00:00 and 12:00 UTC** (`0 0,12 * * *`). It refreshes models.dev once, then force-refreshes every active tenant and invalidates each tenant's routing cache.
- A Postgres advisory lock makes the scheduled run single-winner across replicas, so multi-replica installs do not hit every provider twice per tick. A failing tenant is logged and skipped without stopping the others.
- Hand-added (custom) providers are deliberately excluded: their model lists are curated manually, not fetched from a provider API.
