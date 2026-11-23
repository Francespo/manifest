# Model egress (US gateway)

Some upstream models are only reachable from certain regions. Manifest can send
a single model through a US egress gateway without moving the rest of the
provider's traffic.

The policy is stored per `(tenant, provider, auth_type, model)` in
`model_egress_policies`. A missing row means **auto**: the provider/model default
applies.

## Supported providers

Only OpenCode Go and OpenCode Zen declare `usEgress` in the shared provider
registry. The gateway is a reverse proxy for their API surface, so it speaks
`x-opencode-key` (and `x-target-base` for Zen) rather than arbitrary provider
credentials. Adding another provider would require a gateway that understands
that provider's auth.

## Defaults

- **Crouton Alpha** (`crouton-alpha-free`): auto → US. The model is not
  available in the EU.
- **Muse Spark**: auto → direct. Meta's Geographic Use Policy (updated
  2026-10-12) does not list the EU/Italy among its restricted territories, so
  the direct route is valid unless a workspace explicitly opts in.
- Every other model: auto → direct.

The dashboard switch writes an explicit `us` or `direct` row. Turning an
auto-US model off creates an explicit `direct` row; turning it back on creates
an explicit `us` row.

## Configuration

The gateway is configured with:

| Variable                 | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `OPENCODE_GO_PROXY_BASE` | Base URL of the US gateway (defaults to the private HF Space) |
| `OPENCODE_GO_HF_TOKEN`   | Bearer token for the private Space                            |

The dashboard hides/disables the switches when the token is empty. The
`GET /api/v1/providers/us-egress/health` endpoint probes the gateway's
`/health` route (30-second cache) and surfaces whether it is reachable.

## Security

The gateway sees the OpenCode key for the models routed through it. Enable it
only for models that need it. The gateway URL is deployment configuration, not
user input, so it cannot be used as an open relay through the dashboard.
