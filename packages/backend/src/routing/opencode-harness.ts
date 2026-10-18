import { createHash } from 'crypto';

/**
 * OpenCode harness identity.
 *
 * OpenCode Zen grants its free model tier to first-party OpenCode traffic and
 * only accepts requests that look like the CLI's. Zen checks three things
 * together, and none of them is sufficient on its own:
 *
 *   1. `User-Agent: opencode/<channel>/<version>/<name>`
 *   2. a well-formed OpenCode session id (`ses_…`, see
 *      {@link buildOpencodeSessionId}) in the session headers, and
 *   3. a request body that already carries one of OpenCode's built-in system
 *      prompts (so this only ever unlocks traffic from a real OpenCode caller).
 *
 * Manifest presents the CLI's shape on Zen traffic that does not already come
 * from an OpenCode client. The header set mirrors what the CLI attaches to each
 * model request:
 *
 *   User-Agent: opencode/<channel>/<version>/<name>
 *   x-opencode-client: <name>
 *   x-opencode-session / x-opencode-session-id / x-session-id /
 *   x-session-affinity: <OpenCode session id>
 *   x-opencode-project: <opaque project id>
 *
 * `<name>` is the harness's `OPENCODE_CLIENT` identifier, which upstream
 * defaults to `cli`. Keep these in sync with the upstream CLI; bump the
 * version (and channel) when the released build does.
 */
const OPENCODE_HARNESS_NAME = 'cli';
const OPENCODE_HARNESS_CHANNEL = 'latest';
const OPENCODE_HARNESS_VERSION = '2.0.32';

export const OPENCODE_HARNESS_USER_AGENT = `opencode/${OPENCODE_HARNESS_CHANNEL}/${OPENCODE_HARNESS_VERSION}/${OPENCODE_HARNESS_NAME}`;

/**
 * The CLI mints session ids as `ses_` + a 12-hex timestamp prefix + a 14-char
 * random tail. Zen decodes the prefix and rejects ids whose timestamp is not
 * plausible, so Manifest's opaque `manifest-<hash>` affinity value does not
 * pass the gate — the prefix has to encode a real, recent timestamp.
 */
const OPENCODE_SESSION_ID_PATTERN = /^ses_[0-9a-f]{12}[0-9a-zA-Z]{14}$/;

/** True when the caller already presents an OpenCode-shaped identity we should keep. */
export function hasOpencodeIdentity(headers: Record<string, string>): boolean {
  const client = headers['x-opencode-client'];
  if (typeof client === 'string' && client.trim().length > 0) return true;
  const ua = headers['user-agent'];
  return typeof ua === 'string' && /^opencode\//i.test(ua.trim());
}

/** True when `value` is already a genuine OpenCode session id. */
export function isOpencodeSessionId(value: unknown): value is string {
  return typeof value === 'string' && OPENCODE_SESSION_ID_PATTERN.test(value.trim());
}

// Fixed at module load: the minted prefix stays inside Zen's recent-timestamp
// window, while a given scope keeps stable provider affinity across requests
// (a per-request timestamp would change the id — and the affinity — every call).
const SESSION_EPOCH_MS = Date.now();

/**
 * Mint an OpenCode-shaped session id for a scope. The 12-hex prefix mirrors the
 * CLI's `yY` generator (~(timestamp * 0x1000 + counter) as 6 bytes, so Zen
 * decodes a recent timestamp) and the tail is a deterministic hash of the scope
 * so the same conversation keeps the same affinity.
 */
export function buildOpencodeSessionId(scopeKey: string, now: number = SESSION_EPOCH_MS): string {
  const inverted = ~(BigInt(now) * 0x1000n + 1n);
  const prefix = Array.from({ length: 6 }, (_, i) =>
    Number((inverted >> BigInt(40 - 8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, '0'),
  ).join('');
  const tail = createHash('sha256').update(scopeKey).digest('hex').slice(0, 14);
  return `ses_${prefix}${tail}`;
}

/**
 * Pick the session id to send upstream: forward the caller's own when it is a
 * real OpenCode session id (a genuine OpenCode caller), otherwise mint one for
 * the scope.
 */
export function resolveOpencodeSessionId(opts: {
  callerSession?: string;
  scopeKey?: string;
}): string {
  if (isOpencodeSessionId(opts.callerSession)) return opts.callerSession.trim();
  return buildOpencodeSessionId(opts.scopeKey ?? 'default');
}

function hashScope(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `manifest-${digest}`;
}

/** Opaque, stable identifier for a scope key (never leaks the raw value). */
export function hashOpencodeScope(value: string): string {
  return hashScope(value);
}

/**
 * Headers that make an outbound Zen request look like it came from the OpenCode
 * harness. Every session header carries the same OpenCode session id, and
 * `projectKey` (a raw scope such as a conversation or agent key) is hashed into
 * an opaque project id — Manifest has no real project id, but Zen only needs a
 * stable, opaque identifier. Omitting `sessionId` leaves the session headers to
 * the caller.
 */
export function buildOpencodeHarnessHeaders(opts: {
  sessionId?: string;
  projectKey?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': OPENCODE_HARNESS_USER_AGENT,
    'x-opencode-client': OPENCODE_HARNESS_NAME,
  };
  if (opts.sessionId) {
    headers['x-opencode-session'] = opts.sessionId;
    headers['x-opencode-session-id'] = opts.sessionId;
    headers['x-session-id'] = opts.sessionId;
    headers['x-session-affinity'] = opts.sessionId;
  }
  if (opts.projectKey) headers['x-opencode-project'] = hashScope(opts.projectKey);
  return headers;
}
