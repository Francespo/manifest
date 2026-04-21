import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Default ingest endpoint. Self-hosted installs POST their daily aggregate
 * report here. Can be overridden via `TELEMETRY_ENDPOINT` (useful in tests or
 * for routing through a proxy).
 */
export const DEFAULT_TELEMETRY_ENDPOINT = 'https://telemetry.manifest.build/telemetry/v1/report';

export const TELEMETRY_SCHEMA_VERSION = 1;

/**
 * Public documentation URL listed in the startup log and the ingest payload
 * docs. No network call — this is just a string for operators to read.
 */
export const TELEMETRY_DOCS_URL = 'https://manifest.build/telemetry';

export interface TelemetryConfig {
  enabled: boolean;
  endpoint: string;
  manifestVersion: string;
}

/**
 * Builds the runtime telemetry config from the current process environment.
 *
 * The sender is opt-out — enabled by default and silenced by setting
 * `MANIFEST_TELEMETRY_DISABLED=1`. It is also auto-silenced outside
 * production so dev instances never report.
 */
export function buildTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const disabled = env['MANIFEST_TELEMETRY_DISABLED'];
  const isProd = (env['NODE_ENV'] ?? 'development') === 'production';
  const isDisabled = disabled === '1' || disabled === 'true';
  return {
    enabled: isProd && !isDisabled,
    endpoint: env['TELEMETRY_ENDPOINT'] ?? DEFAULT_TELEMETRY_ENDPOINT,
    manifestVersion: readManifestVersion(),
  };
}

/**
 * Reads the canonical Manifest version from `packages/manifest/package.json`.
 * Works from both `src/telemetry/` (dev via ts-jest) and `dist/telemetry/`
 * (prod) because both are three levels deep from the `packages/` directory.
 */
export function readManifestVersion(): string {
  try {
    const path = resolve(__dirname, '../../../manifest/package.json');
    const raw = readFileSync(path, 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (typeof pkg.version === 'string') return pkg.version;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
