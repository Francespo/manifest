import { hasOpencodeIdentity, isOpencodeSessionId } from './opencode-harness';

const CALLER_SESSION_ID = 'ses_0123456789abABCDEFGHJKMNPQ';

describe('opencode-harness', () => {
  describe('hasOpencodeIdentity', () => {
    it('recognises the CLI client marker', () => {
      expect(hasOpencodeIdentity({ 'x-opencode-client': 'opencode' })).toBe(true);
      expect(hasOpencodeIdentity({ 'x-opencode-client': '  cli  ' })).toBe(true);
    });

    it('recognises an OpenCode User-Agent', () => {
      expect(hasOpencodeIdentity({ 'user-agent': 'opencode/local/2.0.27/opencode' })).toBe(true);
      expect(hasOpencodeIdentity({ 'user-agent': 'OpenCode/1.0.0/cli' })).toBe(true);
    });

    it('rejects anything else', () => {
      expect(hasOpencodeIdentity({})).toBe(false);
      expect(hasOpencodeIdentity({ 'x-opencode-client': '   ' })).toBe(false);
      expect(hasOpencodeIdentity({ 'user-agent': 'pi-coding-agent/0.85.0' })).toBe(false);
      // A UA that merely mentions OpenCode is not the harness identity.
      expect(hasOpencodeIdentity({ 'user-agent': 'my-agent (uses opencode)' })).toBe(false);
    });
  });

  describe('isOpencodeSessionId', () => {
    it('accepts only the CLI id shape', () => {
      expect(isOpencodeSessionId(CALLER_SESSION_ID)).toBe(true);
      expect(isOpencodeSessionId(`  ${CALLER_SESSION_ID}  `)).toBe(true);
    });

    it('rejects everything else, including Manifest’s own affinity value', () => {
      expect(isOpencodeSessionId('manifest-0123456789abcdef0123456789abcdef')).toBe(false);
      expect(isOpencodeSessionId('default')).toBe(false);
      expect(isOpencodeSessionId('ses_tooshort')).toBe(false);
      expect(isOpencodeSessionId('ses_0123456789abABCDEFGHJKMNPQextra')).toBe(false);
      expect(isOpencodeSessionId('ses_0123456789ZZABCDEFGHJKMNPQ')).toBe(false);
      expect(isOpencodeSessionId(undefined)).toBe(false);
      expect(isOpencodeSessionId(42)).toBe(false);
    });
  });
});
