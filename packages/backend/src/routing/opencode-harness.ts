/**
 * OpenCode harness identity — pass-through only.
 *
 * OpenCode Zen serves its free model tier only to first-party OpenCode traffic,
 * and it checks the request as a whole: the CLI's `User-Agent`, a well-formed
 * `ses_…` session id, and a body carrying one of OpenCode's built-in system
 * prompts. Zen is the authority on that check; Manifest's only job is to
 * *forward* what a genuine OpenCode caller already presented, instead of
 * overwriting it with its own opaque `manifest-<hash>` affinity value.
 *
 * Manifest therefore never mints a session id, a `User-Agent`, or a project id
 * to make a non-OpenCode caller look like the CLI. A caller that does not bring
 * an OpenCode identity gets Zen's refusal, which is the honest answer: the free
 * tier is Zen's to grant and it grants it to its own client.
 *
 * The helpers here only answer two questions — "is this caller already
 * OpenCode?" and "is this already a genuine OpenCode session id?" — so the
 * proxy can preserve the caller's own values rather than synthesising any.
 */

/**
 * The CLI mints session ids as `ses_` + a 12-hex timestamp prefix + a 14-char
 * tail. Manifest only recognises that shape; it never produces one.
 */
const OPENCODE_SESSION_ID_PATTERN = /^ses_[0-9a-f]{12}[0-9a-zA-Z]{14}$/;

/** True when the caller already presents an OpenCode-shaped identity. */
export function hasOpencodeIdentity(headers: Record<string, string>): boolean {
  const client = headers['x-opencode-client'];
  if (typeof client === 'string' && client.trim().length > 0) return true;
  const ua = headers['user-agent'];
  return typeof ua === 'string' && /^opencode\//i.test(ua.trim());
}

/** True when `value` is a genuine OpenCode session id supplied by the caller. */
export function isOpencodeSessionId(value: unknown): value is string {
  return typeof value === 'string' && OPENCODE_SESSION_ID_PATTERN.test(value.trim());
}
