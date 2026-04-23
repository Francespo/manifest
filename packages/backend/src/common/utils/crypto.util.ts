import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

let warnedAboutFallback = false;

function warnFallbackOnce(): void {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;

  console.warn(
    '[crypto] MANIFEST_ENCRYPTION_KEY is not set; falling back to BETTER_AUTH_SECRET. ' +
      'These should be separate so the session secret can be rotated without ' +
      're-encrypting every stored provider API key. Set MANIFEST_ENCRYPTION_KEY ' +
      'to a 32+ character random string.',
  );
}

export function getEncryptionSecret(): string {
  const dedicated = process.env['MANIFEST_ENCRYPTION_KEY'];
  if (dedicated && dedicated.length >= 32) return dedicated;

  const fallback = process.env['BETTER_AUTH_SECRET'];
  if (fallback && fallback.length >= 32) {
    warnFallbackOnce();
    return fallback;
  }

  throw new Error(
    'Encryption secret required. Set MANIFEST_ENCRYPTION_KEY or BETTER_AUTH_SECRET (>=32 chars).',
  );
}

/** @internal testing only — resets the once-per-process fallback warning. */
export function __resetFallbackWarningForTests(): void {
  warnedAboutFallback = false;
}

export function encrypt(plaintext: string, secret: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decrypt(ciphertext: string, secret: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid ciphertext format');
  }
  const [saltB64, ivB64, tagB64, encryptedB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 4) return false;
  try {
    for (const part of parts) {
      const buf = Buffer.from(part, 'base64');
      if (buf.toString('base64') !== part) return false;
    }
    return true;
  } catch {
    return false;
  }
}
