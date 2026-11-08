/**
 * Users of the embedded issuer: created with a password, looked up by what
 * they type to sign in. A user's `sub` in tokens is their principal id, so it
 * does not change when sign-in methods are added or removed (ADR 0028).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { checkPassword, hashPassword, MIN_PASSWORD_LENGTH } from './password.js';

export interface NewPasswordUser {
  /** An email address or a user name; what they type to sign in. */
  login: string;
  password: string;
  displayName?: string | undefined;
  email?: string | undefined;
  isAdmin?: boolean | undefined;
}

export class AccountError extends Error {}

/** Creates the user, their identity at `issuer` and their password. Returns the principal id. */
export async function createPasswordUser(
  db: Kysely<Database>,
  issuer: string,
  input: NewPasswordUser,
): Promise<string> {
  const login = input.login.trim();
  if (!login) throw new AccountError('A login is required');
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(`The password must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = await hashPassword(input.password);
  return db.transaction().execute(async (trx) => {
    const taken = await trx
      .selectFrom('credentials')
      .select('principal_id')
      .where(sql`lower(login)`, '=', login.toLowerCase())
      .executeTakeFirst();
    if (taken) throw new AccountError('That login is already in use');
    const principal = await trx
      .insertInto('principals')
      .values({ kind: 'user' })
      .returning('id')
      .executeTakeFirstOrThrow();
    // issuer and subject stay on `users` for pods of the previous release (migration 0012).
    await trx
      .insertInto('users')
      .values({
        principal_id: principal.id,
        issuer,
        subject: principal.id,
        display_name: input.displayName ?? null,
        email: input.email ?? (login.includes('@') ? login : null),
        is_admin: input.isAdmin ?? false,
      })
      .execute();
    await trx
      .insertInto('identities')
      .values({ issuer, subject: principal.id, principal_id: principal.id })
      .execute();
    await trx
      .insertInto('credentials')
      .values({ principal_id: principal.id, login, password_hash: passwordHash })
      .execute();
    return principal.id;
  });
}

/** The principal id when `login` and `password` are right; undefined otherwise, in the same time either way. */
export async function verifyLogin(
  db: Kysely<Database>,
  login: string,
  password: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom('credentials')
    .select(['principal_id', 'password_hash'])
    .where(sql`lower(login)`, '=', login.trim().toLowerCase())
    .executeTakeFirst();
  const ok = await checkPassword(row?.password_hash, password);
  return ok ? row?.principal_id : undefined;
}

export interface AccountProfile {
  name: string | undefined;
  email: string | undefined;
}

/** The profile the tokens carry, or undefined when there is no such user. */
export async function loadProfile(
  db: Kysely<Database>,
  principalId: string,
): Promise<AccountProfile | undefined> {
  const row = await db
    .selectFrom('users')
    .select(['display_name', 'email'])
    .where('principal_id', '=', principalId)
    .executeTakeFirst();
  if (!row) return undefined;
  return { name: row.display_name ?? undefined, email: row.email ?? undefined };
}

/** Replaces a user's password. Returns false when no user has that login. */
export async function setPassword(
  db: Kysely<Database>,
  login: string,
  password: string,
): Promise<boolean> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(`The password must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const result = await db
    .updateTable('credentials')
    .set({ password_hash: await hashPassword(password), updated_at: sql`now()` })
    .where(sql`lower(login)`, '=', login.trim().toLowerCase())
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
