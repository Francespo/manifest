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
export function hasOpencodeIdentity(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const client = headers['x-opencode-client'];
  for (const value of Array.isArray(client) ? client : [client]) {
    if (typeof value === 'string' && value.trim().length > 0) return true;
  }
  const ua = headers['user-agent'];
  for (const value of Array.isArray(ua) ? ua : [ua]) {
    if (typeof value === 'string' && /^opencode\//i.test(value.trim())) return true;
  }
  return false;
}

/** True when `value` is a genuine OpenCode session id supplied by the caller. */
export function isOpencodeSessionId(value: unknown): value is string {
  return typeof value === 'string' && OPENCODE_SESSION_ID_PATTERN.test(value.trim());
}

/**
 * Zen names its free-tier ids `<model>-free`; the stealth model carries a
 * plain id. These are exactly the models Zen reserves to first-party OpenCode
 * traffic — the billed catalog is open to any authenticated caller, so only
 * the free tier is gated.
 */
const OPENCODE_ZEN_FREE_MODEL_SUFFIX = '-free';
const OPENCODE_ZEN_FREE_MODEL_IDS: ReadonlySet<string> = new Set(['big-pickle']);

/**
 * True when `model` names an OpenCode Zen free-tier model. Accepts the public
 * `opencode-zen/<id>` route form and the bare gateway id.
 */
export function isOpencodeZenFreeModel(model: unknown): boolean {
  if (typeof model !== 'string') return false;
  const normalized = model.trim().toLowerCase();
  if (!normalized) return false;
  const id = normalized.slice(normalized.lastIndexOf('/') + 1);
  return id.endsWith(OPENCODE_ZEN_FREE_MODEL_SUFFIX) || OPENCODE_ZEN_FREE_MODEL_IDS.has(id);
}
