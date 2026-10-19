import {
  hasOpencodeIdentity,
  isOpencodeSessionId,
  isOpencodeZenFreeModel,
} from './opencode-harness';

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

    it('recognises repeated header values', () => {
      expect(hasOpencodeIdentity({ 'x-opencode-client': ['', 'opencode'] })).toBe(true);
      expect(hasOpencodeIdentity({ 'user-agent': ['curl/8.5', 'opencode/1.0/cli'] })).toBe(true);
    });

    it('rejects anything else', () => {
      expect(hasOpencodeIdentity({})).toBe(false);
      expect(hasOpencodeIdentity({ 'x-opencode-client': '   ' })).toBe(false);
      expect(hasOpencodeIdentity({ 'user-agent': 'pi-coding-agent/0.85.0' })).toBe(false);
      // A UA that merely mentions OpenCode is not the harness identity.
      expect(hasOpencodeIdentity({ 'user-agent': 'my-agent (uses opencode)' })).toBe(false);
    });
  });

  describe('isOpencodeZenFreeModel', () => {
    it('recognises the free-tier shapes', () => {
      expect(isOpencodeZenFreeModel('opencode-zen/big-pickle')).toBe(true);
      expect(isOpencodeZenFreeModel('big-pickle')).toBe(true);
      expect(isOpencodeZenFreeModel('opencode-zen/deepseek-v4.1-flash-free')).toBe(true);
      expect(isOpencodeZenFreeModel('glm-5.3-flash-free')).toBe(true);
      expect(isOpencodeZenFreeModel('  opencode-zen/big-pickle  ')).toBe(true);
    });

    it('leaves the billed catalog alone', () => {
      expect(isOpencodeZenFreeModel('opencode-zen/claude-sonnet-4-5')).toBe(false);
      expect(isOpencodeZenFreeModel('claude-opus-5')).toBe(false);
      // `free` in the middle of an id is not the free-tier shape.
      expect(isOpencodeZenFreeModel('opencode-zen/free-tier-test')).toBe(false);
      expect(isOpencodeZenFreeModel(undefined)).toBe(false);
      expect(isOpencodeZenFreeModel(42)).toBe(false);
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
