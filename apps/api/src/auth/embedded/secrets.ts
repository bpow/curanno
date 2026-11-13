/**
 * What AUTH_SECRET protects (ADR 0028): the signing keys stored in the
 * database, so that a dump of it cannot mint tokens, and the keys of the
 * provider's cookies, which every replica must share. Each use derives its own
 * key from the secret.
 */
import { createDecipheriv, hkdfSync } from 'node:crypto';
import { CompactEncrypt, compactDecrypt } from 'jose';

function derive(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'curanno', purpose, 32));
}

/** Keys for the provider's signed cookies; the first signs, all verify. */
export function cookieKeys(secret: string): string[] {
  return [derive(secret, 'cookies').toString('base64url')];
}

const ENCRYPTION = { alg: 'dir', enc: 'A256GCM' } as const;

/** A compact JWE: AES-256-GCM under the key derived from the secret. */
export async function seal(secret: string, plaintext: string): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(plaintext))
    .setProtectedHeader(ENCRYPTION)
    .encrypt(derive(secret, 'signing-keys'));
}

export async function unseal(secret: string, sealed: string): Promise<string> {
  if (sealed.startsWith('v1.')) return unsealV1(secret, sealed);
  const { plaintext } = await compactDecrypt(sealed, derive(secret, 'signing-keys'), {
    keyManagementAlgorithms: [ENCRYPTION.alg],
    contentEncryptionAlgorithms: [ENCRYPTION.enc],
  });
  return new TextDecoder().decode(plaintext);
}

const TAG_BYTES = 16;

/**
 * The format keys were sealed in before JWE, `v1.<iv>.<tag>.<ciphertext>` in
 * base64url, still read so that keys already in a database keep working.
 */
function unsealV1(secret: string, sealed: string): string {
  const [, iv, tag, body] = sealed.split('.');
  if (!iv || !tag || !body) throw new Error('unrecognised sealed value');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derive(secret, 'signing-keys'),
    Buffer.from(iv, 'base64url'),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
