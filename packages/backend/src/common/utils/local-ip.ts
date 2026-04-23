import { BlockList, isIPv4, isIPv6 } from 'net';

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8);
LOOPBACK.addAddress('::1', 'ipv6');

const MAPPED_V4_PREFIX = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

export function isLoopbackIp(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const mapped = ip.match(MAPPED_V4_PREFIX);
  const candidate = mapped ? mapped[1] : ip;
  if (isIPv4(candidate)) return LOOPBACK.check(candidate, 'ipv4');
  if (isIPv6(candidate)) return LOOPBACK.check(candidate, 'ipv6');
  return false;
}

// Resolve the loopback question from the TCP socket peer, not from req.ip.
// Express rewrites req.ip from the X-Forwarded-For chain whenever
// `trust proxy` is enabled, so a misconfigured reverse proxy (or an
// attacker who controls any hop) could forge a loopback identity.
// The socket peer is the actual TCP sender and cannot be spoofed by
// HTTP headers.
export function isLoopbackRequest(request: {
  socket?: { remoteAddress?: string | null };
}): boolean {
  return isLoopbackIp(request.socket?.remoteAddress ?? null);
}
