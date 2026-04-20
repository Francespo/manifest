/**
 * Shape of the payload POSTed once per 24h from a self-hosted install to the
 * ingest endpoint. Kept deliberately small: 8 fields, no per-request events,
 * no identifiers beyond the random `install_id` and the Manifest version.
 *
 * Additive-only changes bump `schema_version`.
 */
export interface TelemetryPayloadV1 {
  schema_version: 1;
  install_id: string;
  manifest_version: string;
  messages_total: number;
  messages_by_provider: Record<string, number>;
  tokens_input_total: number;
  tokens_output_total: number;
  agents_total: number;
}
