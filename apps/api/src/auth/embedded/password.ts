/**
 * Passwords are hashed with argon2id at the parameters OWASP recommends
 * (19 MiB, two passes, one lane). Checking a login that does not exist still
 * costs a hash, so response time does not say which logins exist.
 */
import { hash, verify, type Options } from '@node-rs/argon2';

const OPTIONS: Options = {
  algorithm: 2, // Argon2id; the enum is const and cannot be imported
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 1024;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

let decoy: Promise<string> | undefined;

/** Whether `password` matches `hashed`; with no hash, spends the same time and answers false. */
export async function checkPassword(
  hashed: string | undefined,
  password: string,
): Promise<boolean> {
  if (hashed === undefined) {
    decoy ??= hashPassword('decoy password that no one chose');
    await verify(await decoy, password).catch(() => false);
    return false;
  }
  return verify(hashed, password).catch(() => false);
}
