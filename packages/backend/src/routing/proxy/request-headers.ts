import type { IncomingHttpHeaders } from 'http';

const MAX_HEADERS = 50;
const MAX_VALUE_LEN = 1024;
const MAX_TOTAL_BYTES = 8192;

// Headers that can carry secrets — dropped entirely so they never hit the DB.
const SENSITIVE_HEADERS = new Set<string>([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);

export function sanitizeRequestHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  let totalBytes = 2; // account for `{}` of the eventual JSON
  let count = 0;

  for (const [rawKey, rawVal] of Object.entries(headers)) {
    if (count >= MAX_HEADERS) break;
    if (rawVal == null) continue;

    const key = rawKey.toLowerCase();
    if (SENSITIVE_HEADERS.has(key)) continue;

    const joined = Array.isArray(rawVal) ? rawVal.join(', ') : String(rawVal);
    const cleaned = joined.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!cleaned) continue;

    const value =
      cleaned.length > MAX_VALUE_LEN ? `${cleaned.slice(0, MAX_VALUE_LEN - 1)}…` : cleaned;

    const entryBytes = jsonEntryByteCost(key, value, count === 0);
    if (totalBytes + entryBytes > MAX_TOTAL_BYTES) continue;

    out[key] = value;
    totalBytes += entryBytes;
    count++;
  }

  return count > 0 ? out : null;
}

// Approximates the byte cost of serializing `"key":"value"` (plus leading comma
// for non-first entries) as UTF-8, without running the whole object through
// JSON.stringify on every iteration.
function jsonEntryByteCost(key: string, value: string, isFirst: boolean): number {
  const keyBytes = Buffer.byteLength(key, 'utf8');
  const valueBytes = Buffer.byteLength(value, 'utf8');
  // 2 quotes around key + ':' + 2 quotes around value = 5, plus ',' for non-first
  return keyBytes + valueBytes + 5 + (isFirst ? 0 : 1);
}
