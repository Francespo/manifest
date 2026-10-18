import {
  buildOpencodeHarnessHeaders,
  buildOpencodeSessionId,
  isOpencodeSessionId,
  resolveOpencodeSessionId,
  OPENCODE_HARNESS_USER_AGENT,
} from './opencode-harness';

const SESSION_ID_RE = /^ses_[0-9a-f]{12}[0-9a-zA-Z]{14}$/;

describe('opencode-harness', () => {
  describe('isOpencodeSessionId', () => {
    it('accepts a well-formed OpenCode session id', () => {
      expect(isOpencodeSessionId('ses_0123456789abABCDEFGHJKMNPQ')).toBe(true);
      expect(isOpencodeSessionId(buildOpencodeSessionId('scope'))).toBe(true);
    });

    it('rejects anything that is not the CLI shape', () => {
      // Manifest's opaque affinity value — the shape Zen rejects.
      expect(isOpencodeSessionId('manifest-0123456789abcdef0123456789abcdef')).toBe(false);
      expect(isOpencodeSessionId('default')).toBe(false);
      expect(isOpencodeSessionId('ses_tooshort')).toBe(false);
      expect(isOpencodeSessionId('ses_0123456789abABCDEFGHJKMNPQextra')).toBe(false);
      expect(isOpencodeSessionId(undefined)).toBe(false);
      expect(isOpencodeSessionId(42)).toBe(false);
    });
  });

  describe('buildOpencodeSessionId', () => {
    it('mints a well-formed, timestamp-prefixed id', () => {
      const now = 1_792_000_000_000;
      const id = buildOpencodeSessionId('conv-1', now);
      expect(id).toMatch(SESSION_ID_RE);

      // The 12-hex prefix must decode back to `now` (mod 2^36), matching the
      // CLI's `~(timestamp * 0x1000 + counter)` encoding.
      const prefix = BigInt(`0x${id.slice(4, 16)}`);
      const decoded = ((~prefix & 0xffffffffffffn) >> 12n).toString();
      expect(decoded).toBe(String(now % 2 ** 36));
    });

    it('is stable for the same scope and timestamp, and varies by scope', () => {
      const now = 1_792_000_000_000;
      expect(buildOpencodeSessionId('a', now)).toBe(buildOpencodeSessionId('a', now));
      expect(buildOpencodeSessionId('a', now)).not.toBe(buildOpencodeSessionId('b', now));
    });
  });

  describe('resolveOpencodeSessionId', () => {
    it('forwards the caller session id when it is already OpenCode-shaped', () => {
      const caller = 'ses_0123456789abABCDEFGHJKMNPQ';
      expect(resolveOpencodeSessionId({ callerSession: caller })).toBe(caller);
    });

    it('mints a fresh id when the caller session is missing or not OpenCode-shaped', () => {
      expect(resolveOpencodeSessionId({ callerSession: 'default' })).toMatch(SESSION_ID_RE);
      expect(resolveOpencodeSessionId({})).toMatch(SESSION_ID_RE);
    });
  });

  describe('buildOpencodeHarnessHeaders', () => {
    it('carries the harness identity and the session id on every session header', () => {
      const sessionId = 'ses_0123456789abABCDEFGHJKMNPQ';
      expect(buildOpencodeHarnessHeaders({ sessionId, projectKey: 'conv-1' })).toEqual({
        'user-agent': OPENCODE_HARNESS_USER_AGENT,
        'x-opencode-client': 'cli',
        'x-opencode-session': sessionId,
        'x-opencode-session-id': sessionId,
        'x-session-id': sessionId,
        'x-session-affinity': sessionId,
        'x-opencode-project': expect.stringMatching(/^manifest-[a-f0-9]{32}$/),
      });
    });

    it('omits the session and project headers when not provided', () => {
      expect(buildOpencodeHarnessHeaders({})).toEqual({
        'user-agent': OPENCODE_HARNESS_USER_AGENT,
        'x-opencode-client': 'cli',
      });
    });
  });
});
