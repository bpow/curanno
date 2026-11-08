/**
 * What AUTH_SECRET protects (ADR 0028): the signing keys stored in the
 * database, so that a dump of it cannot mint tokens, and the keys of the
 * provider's cookies, which every replica must share. Each use derives its own
 * key from the secret.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

function derive(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'curanno', purpose, 32));
}

/** Keys for the provider's signed cookies; the first signs, all verify. */
export function cookieKeys(secret: string): string[] {
  return [derive(secret, 'cookies').toString('base64url')];
}

/** AES-256-GCM, as `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function seal(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(secret, 'signing-keys'), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function unseal(secret: string, sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('unrecognised sealed value');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derive(secret, 'signing-keys'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
