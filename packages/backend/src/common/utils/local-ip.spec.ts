import { isLoopbackIp, isLoopbackRequest } from './local-ip';

describe('isLoopbackIp', () => {
  it('accepts IPv4 loopback', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
  });

  it('accepts the whole 127.0.0.0/8 range', () => {
    expect(isLoopbackIp('127.0.0.2')).toBe(true);
    expect(isLoopbackIp('127.255.255.254')).toBe(true);
  });

  it('accepts IPv6 loopback in canonical form', () => {
    expect(isLoopbackIp('::1')).toBe(true);
  });

  it('accepts IPv6 loopback in fully expanded form', () => {
    expect(isLoopbackIp('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('accepts IPv4-mapped IPv6 loopback (short prefix)', () => {
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('accepts IPv4-mapped IPv6 loopback (long prefix)', () => {
    expect(isLoopbackIp('0:0:0:0:0:ffff:127.0.0.1')).toBe(true);
  });

  it('rejects public IPv4', () => {
    expect(isLoopbackIp('203.0.113.1')).toBe(false);
    expect(isLoopbackIp('8.8.8.8')).toBe(false);
  });

  it('rejects private IPv4', () => {
    expect(isLoopbackIp('10.0.0.1')).toBe(false);
    expect(isLoopbackIp('192.168.1.1')).toBe(false);
  });

  it('rejects IPv6 link-local', () => {
    expect(isLoopbackIp('fe80::1')).toBe(false);
  });

  it('rejects non-IP strings', () => {
    expect(isLoopbackIp('localhost')).toBe(false);
    expect(isLoopbackIp('not-an-ip')).toBe(false);
    expect(isLoopbackIp('')).toBe(false);
  });

  it('rejects undefined / null', () => {
    expect(isLoopbackIp(undefined)).toBe(false);
    expect(isLoopbackIp(null)).toBe(false);
  });
});

describe('isLoopbackRequest', () => {
  it('reads the TCP socket peer, not req.ip', () => {
    const req = { ip: '127.0.0.1', socket: { remoteAddress: '203.0.113.1' } };
    expect(isLoopbackRequest(req)).toBe(false);
  });

  it('returns true when socket peer is loopback', () => {
    const req = { ip: '203.0.113.1', socket: { remoteAddress: '127.0.0.1' } };
    expect(isLoopbackRequest(req)).toBe(true);
  });

  it('handles missing socket gracefully', () => {
    expect(isLoopbackRequest({})).toBe(false);
  });

  it('handles missing remoteAddress gracefully', () => {
    expect(isLoopbackRequest({ socket: {} })).toBe(false);
  });

  it('handles null remoteAddress gracefully', () => {
    expect(isLoopbackRequest({ socket: { remoteAddress: null } })).toBe(false);
  });
});
