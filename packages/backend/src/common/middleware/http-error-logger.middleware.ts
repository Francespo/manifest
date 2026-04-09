import { Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const logger = new Logger('HttpErrors');

/** Paths from old OTLP clients that are expected 410s — don't log them. */
const SUPPRESSED_PREFIXES = ['/otlp/', '/api/v1/otlp/'];

function isSuppressed(url: string, status: number): boolean {
  if (status !== 410 && status !== 404) return false;
  for (const prefix of SUPPRESSED_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }
  return false;
}

export function httpErrorLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    if (res.statusCode < 400) return;
    if (isSuppressed(req.originalUrl, res.statusCode)) return;

    const elapsed = Date.now() - start;
    const ua = (req.headers['user-agent'] ?? '').slice(0, 120);
    const ip = req.headers['x-forwarded-for'] ?? req.ip ?? '';
    const forwardedIp = Array.isArray(ip) ? ip[0] : ip;

    logger.warn(
      `${res.statusCode} ${req.method} ${req.originalUrl} ${elapsed}ms ip=${forwardedIp} ua=${ua}`,
    );
  });

  next();
}
