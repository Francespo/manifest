import { rewriteOgTags } from './og-rewrite';

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:url" content="https://app.manifest.build" />
    <meta property="og:image" content="https://app.manifest.build/og-image.png" />
    <meta name="twitter:image" content="https://app.manifest.build/og-image.png" />
  </head>
</html>`;

describe('rewriteOgTags', () => {
  it('returns the input unchanged when baseUrl is empty', () => {
    expect(rewriteOgTags(SAMPLE_HTML, '')).toBe(SAMPLE_HTML);
  });

  it('returns the input unchanged when baseUrl matches the default', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'https://app.manifest.build')).toBe(SAMPLE_HTML);
  });

  it('returns the input unchanged when baseUrl matches the default with a trailing slash', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'https://app.manifest.build/')).toBe(SAMPLE_HTML);
  });

  it('rewrites all occurrences of the default base to the custom base', () => {
    const result = rewriteOgTags(SAMPLE_HTML, 'https://manifest.example.com');
    expect(result).toContain('content="https://manifest.example.com"');
    expect(result).toContain('content="https://manifest.example.com/og-image.png"');
    expect(result).not.toContain('https://app.manifest.build');
  });

  it('strips trailing slashes from the custom base', () => {
    const result = rewriteOgTags(SAMPLE_HTML, 'https://manifest.example.com//');
    expect(result).toContain('content="https://manifest.example.com"');
    expect(result).toContain('content="https://manifest.example.com/og-image.png"');
  });

  it('preserves the og:image path suffix', () => {
    const result = rewriteOgTags(SAMPLE_HTML, 'http://localhost:3001');
    expect(result).toContain('content="http://localhost:3001/og-image.png"');
  });

  it('handles a string with no occurrences gracefully', () => {
    expect(rewriteOgTags('<html></html>', 'https://manifest.example.com')).toBe('<html></html>');
  });

  it('trims whitespace from baseUrl', () => {
    const result = rewriteOgTags(SAMPLE_HTML, '  https://manifest.example.com  ');
    expect(result).toContain('content="https://manifest.example.com"');
  });

  it('returns input unchanged for an unparseable baseUrl', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'not a url')).toBe(SAMPLE_HTML);
  });

  it('rejects a baseUrl with embedded HTML (injection attempt)', () => {
    const attacker = 'https://evil.example.com/"><script>alert(1)</script>';
    expect(rewriteOgTags(SAMPLE_HTML, attacker)).toBe(SAMPLE_HTML);
  });

  it('rejects non-http(s) schemes', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'javascript:alert(1)')).toBe(SAMPLE_HTML);
    expect(rewriteOgTags(SAMPLE_HTML, 'file:///etc/passwd')).toBe(SAMPLE_HTML);
  });

  it('rejects baseUrl with userinfo', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'https://user:pass@evil.example.com')).toBe(SAMPLE_HTML);
  });

  it('rejects baseUrl with a path', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'https://manifest.example.com/sneaky')).toBe(SAMPLE_HTML);
  });

  it('rejects baseUrl with a query string', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'https://manifest.example.com?x=1')).toBe(SAMPLE_HTML);
  });

  it('rejects baseUrl with a fragment', () => {
    expect(rewriteOgTags(SAMPLE_HTML, 'https://manifest.example.com#frag')).toBe(SAMPLE_HTML);
  });
});
