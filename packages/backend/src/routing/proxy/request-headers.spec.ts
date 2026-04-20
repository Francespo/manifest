import { sanitizeRequestHeaders } from './request-headers';

describe('sanitizeRequestHeaders', () => {
  it('returns null when no headers are provided', () => {
    expect(sanitizeRequestHeaders({})).toBeNull();
  });

  it('returns null when every header is empty or sensitive', () => {
    expect(
      sanitizeRequestHeaders({
        authorization: 'Bearer mnfst_secret',
        cookie: 'session=abc',
        'x-blank': '   ',
      }),
    ).toBeNull();
  });

  it('keeps ordinary headers and lowercases keys', () => {
    expect(
      sanitizeRequestHeaders({
        'Content-Type': 'application/json',
        'User-Agent': 'curl/8.14.1',
        'X-Custom-Foo': 'bar',
      }),
    ).toEqual({
      'content-type': 'application/json',
      'user-agent': 'curl/8.14.1',
      'x-custom-foo': 'bar',
    });
  });

  it('drops sensitive headers regardless of casing', () => {
    const result = sanitizeRequestHeaders({
      Authorization: 'Bearer mnfst_secret',
      Cookie: 'session=abc',
      'Set-Cookie': 'x=y',
      'Proxy-Authorization': 'Basic xxx',
      'X-API-Key': 'abc',
      'x-safe': 'keep',
    });
    expect(result).toEqual({ 'x-safe': 'keep' });
  });

  it('flattens array values with comma-space separator', () => {
    expect(sanitizeRequestHeaders({ 'x-multi': ['a', 'b', 'c'] })).toEqual({
      'x-multi': 'a, b, c',
    });
  });

  it('skips headers with null/undefined values', () => {
    expect(
      sanitizeRequestHeaders({
        'x-keep': 'yes',
        'x-null': undefined,
      }),
    ).toEqual({ 'x-keep': 'yes' });
  });

  it('strips control characters and trims whitespace', () => {
    expect(
      sanitizeRequestHeaders({
        'x-dirty': '  hello\u0001world\u007f  ',
      }),
    ).toEqual({ 'x-dirty': 'helloworld' });
  });

  it('truncates values longer than 1024 chars with an ellipsis', () => {
    const big = 'a'.repeat(2000);
    const result = sanitizeRequestHeaders({ 'x-big': big });
    const value = result!['x-big'];
    expect(value.length).toBe(1024);
    expect(value.endsWith('…')).toBe(true);
    expect(value.slice(0, 1023)).toBe('a'.repeat(1023));
  });

  it('caps the total number of headers at 50', () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 100; i++) headers[`x-h-${i}`] = 'v';
    const result = sanitizeRequestHeaders(headers);
    expect(Object.keys(result!).length).toBe(50);
  });

  it('respects the 8 KB total byte budget', () => {
    const headers: Record<string, string> = {};
    // Each entry ~1 KB; at most ~8 should fit (budget is 8192 bytes).
    for (let i = 0; i < 20; i++) headers[`x-chunk-${i}`] = 'a'.repeat(1000);
    const result = sanitizeRequestHeaders(headers);
    const serialized = Buffer.byteLength(JSON.stringify(result), 'utf8');
    expect(serialized).toBeLessThanOrEqual(8192);
    expect(Object.keys(result!).length).toBeLessThan(20);
    expect(Object.keys(result!).length).toBeGreaterThan(0);
  });
});
