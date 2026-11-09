/**
 * Users of the embedded issuer: created with a password, looked up by what
 * they type to sign in. A user's `sub` in tokens is their principal id, so it
 * does not change when sign-in methods are added or removed (ADR 0028).
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, UserStatus } from '../../db/schema.js';
import { consumeToken } from './tokens.js';
import {
  checkPassword,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from './password.js';

export interface NewPasswordUser {
  /** An email address or a user name; what they type to sign in. */
  login: string;
  password: string;
  displayName?: string | undefined;
  email?: string | undefined;
  /** Whether someone has vouched that the user owns `email`: the operator, or a followed link. */
  emailVerified?: boolean | undefined;
  isAdmin?: boolean | undefined;
  /** `active` unless the user must wait for approval. */
  status?: UserStatus | undefined;
}

export class AccountError extends Error {}

function checkNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(`The password must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw new AccountError('The password is too long');
}

/** Creates the user, their identity at `issuer` and their password. Returns the principal id. */
export async function createPasswordUser(
  db: Kysely<Database>,
  issuer: string,
  input: NewPasswordUser,
): Promise<string> {
  checkNewPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  return db.transaction().execute((trx) => insertPasswordUser(trx, issuer, input, passwordHash));
}

export async function insertPasswordUser(
  trx: Transaction<Database>,
  issuer: string,
  input: NewPasswordUser,
  passwordHash: string,
): Promise<string> {
  const login = input.login.trim();
  if (!login) throw new AccountError('A login is required');
  const email = input.email ?? (login.includes('@') ? login : undefined);
  const taken = await trx
    .selectFrom('credentials')
    .select('principal_id')
    .where(sql`lower(login)`, '=', login.toLowerCase())
    .executeTakeFirst();
  if (taken) throw new AccountError('That login is already in use');
  if (email && input.emailVerified) {
    const owned = await trx
      .selectFrom('user_emails')
      .select('principal_id')
      .where(sql`lower(email)`, '=', email.toLowerCase())
      .where('verified_at', 'is not', null)
      .executeTakeFirst();
    if (owned) throw new AccountError('That email address belongs to another user');
  }
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
      email: email ?? null,
      is_admin: input.isAdmin ?? false,
      status: input.status ?? 'active',
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
  if (email) {
    await trx
      .insertInto('user_emails')
      .values({
        principal_id: principal.id,
        email,
        verified_at: input.emailVerified ? new Date() : null,
        is_primary: Boolean(input.emailVerified),
      })
      .execute();
  }
  return principal.id;
}

/** The principal id when `login` and `password` are right; undefined otherwise, in the same time either way. */
export async function verifyLogin(
  db: Kysely<Database>,
  login: string,
  password: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom('credentials')
    .innerJoin('users', 'users.principal_id', 'credentials.principal_id')
    .select(['credentials.principal_id', 'credentials.password_hash', 'users.status'])
    .where(sql`lower(credentials.login)`, '=', login.trim().toLowerCase())
    .executeTakeFirst();
  const ok = await checkPassword(row?.password_hash, password);
  // A disabled user is refused as if the password were wrong.
  return ok && row?.status !== 'disabled' ? row?.principal_id : undefined;
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
  checkNewPassword(password);
  const result = await db
    .updateTable('credentials')
    .set({ password_hash: await hashPassword(password), updated_at: sql`now()` })
    .where(sql`lower(login)`, '=', login.trim().toLowerCase())
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

/** Replaces the password of a user by principal, after the caller has proven the right to. */
export async function setPasswordFor(
  db: Kysely<Database>,
  principalId: string,
  password: string,
): Promise<void> {
  checkNewPassword(password);
  await db
    .updateTable('credentials')
    .set({ password_hash: await hashPassword(password), updated_at: sql`now()` })
    .where('principal_id', '=', principalId)
    .execute();
}

/** Whether `password` is the user's current one. */
export async function checkCurrentPassword(
  db: Kysely<Database>,
  principalId: string,
  password: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('credentials')
    .select('password_hash')
    .where('principal_id', '=', principalId)
    .executeTakeFirst();
  return checkPassword(row?.password_hash, password);
}

/** Creates the user an invitation was for, in the same transaction that used the link up. */
export async function acceptInvite(
  db: Kysely<Database>,
  issuer: string,
  token: string,
  details: { password: string; displayName: string },
): Promise<string | undefined> {
  checkNewPassword(details.password);
  const passwordHash = await hashPassword(details.password);
  return db.transaction().execute(async (trx) => {
    const invite = await consumeToken(trx, 'invite', token);
    if (!invite) return undefined;
    return insertPasswordUser(
      trx,
      issuer,
      {
        login: invite.email,
        password: details.password,
        displayName: details.displayName.trim() || invite.email,
        email: invite.email,
        emailVerified: true,
        isAdmin: invite.isAdmin,
      },
      passwordHash,
    );
  });
}

/** The principal whose login or verified address is `email`, for a password reset. */
export async function findByEmail(
  db: Kysely<Database>,
  email: string,
): Promise<{ principalId: string; email: string } | undefined> {
  const wanted = email.trim().toLowerCase();
  const verified = await db
    .selectFrom('user_emails')
    .select(['principal_id', 'email'])
    .where(sql`lower(email)`, '=', wanted)
    .where('verified_at', 'is not', null)
    .executeTakeFirst();
  if (verified) return { principalId: verified.principal_id, email: verified.email };
  return undefined;
}

export interface EmailEntry {
  email: string;
  verified: boolean;
  primary: boolean;
}

export async function listEmails(db: Kysely<Database>, principalId: string): Promise<EmailEntry[]> {
  const rows = await db
    .selectFrom('user_emails')
    .select(['email', 'verified_at', 'is_primary'])
    .where('principal_id', '=', principalId)
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({
    email: r.email,
    verified: r.verified_at !== null,
    primary: r.is_primary,
  }));
}

/** Records an address, unverified, for the user; false when they already have it. */
export async function addEmail(
  db: Kysely<Database>,
  principalId: string,
  email: string,
): Promise<boolean> {
  const result = await db
    .insertInto('user_emails')
    .values({ principal_id: principalId, email: email.trim() })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
}

/**
 * Marks the address verified, if the link's owner still has it and no other
 * user verified it first. The first verified address becomes the primary.
 */
export async function verifyEmail(
  db: Kysely<Database>,
  principalId: string,
  email: string,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const taken = await trx
      .selectFrom('user_emails')
      .select('principal_id')
      .where(sql`lower(email)`, '=', email.toLowerCase())
      .where('verified_at', 'is not', null)
      .where('principal_id', '<>', principalId)
      .executeTakeFirst();
    if (taken) return false;
    const updated = await trx
      .updateTable('user_emails')
      .set({ verified_at: sql`coalesce(verified_at, now())` })
      .where('principal_id', '=', principalId)
      .where(sql`lower(email)`, '=', email.toLowerCase())
      .executeTakeFirst();
    if (updated.numUpdatedRows === 0n) return false;
    const hasPrimary = await trx
      .selectFrom('user_emails')
      .select('email')
      .where('principal_id', '=', principalId)
      .where('is_primary', '=', true)
      .executeTakeFirst();
    if (!hasPrimary) await makePrimary(trx, principalId, email);
    return true;
  });
}

/** Makes a verified address the one the user's tokens carry. */
export async function makePrimary(
  trx: Kysely<Database>,
  principalId: string,
  email: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom('user_emails')
    .select('email')
    .where('principal_id', '=', principalId)
    .where(sql`lower(email)`, '=', email.toLowerCase())
    .where('verified_at', 'is not', null)
    .executeTakeFirst();
  if (!row) return false;
  await trx
    .updateTable('user_emails')
    .set({ is_primary: false })
    .where('principal_id', '=', principalId)
    .where('is_primary', '=', true)
    .execute();
  await trx
    .updateTable('user_emails')
    .set({ is_primary: true })
    .where('principal_id', '=', principalId)
    .where(sql`lower(email)`, '=', email.toLowerCase())
    .execute();
  await trx
    .updateTable('users')
    .set({ email: row.email })
    .where('principal_id', '=', principalId)
    .execute();
  return true;
}

/** Removes an address that is not the primary one. */
export async function removeEmail(
  db: Kysely<Database>,
  principalId: string,
  email: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom('user_emails')
    .where('principal_id', '=', principalId)
    .where(sql`lower(email)`, '=', email.toLowerCase())
    .where('is_primary', '=', false)
    .executeTakeFirst();
  return result.numDeletedRows > 0n;
}

/** The user's sign-in name, for the account page. */
export async function loadLogin(
  db: Kysely<Database>,
  principalId: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom('credentials')
    .select('login')
    .where('principal_id', '=', principalId)
    .executeTakeFirst();
  return row?.login;
}

export interface SignupInput extends NewPasswordUser {
  displayName: string;
  note?: string | undefined;
}

export class SignupRefused extends Error {}

/**
 * Creates a user who signed up by themself. Under approval they are `pending`
 * and have an application; under open sign-up they are active at once. The
 * queue is capped, so a flood of sign-ups cannot grow without bound.
 */
export async function signUp(
  db: Kysely<Database>,
  issuer: string,
  input: SignupInput,
  options: { approval: boolean; maxPending: number },
): Promise<{ principalId: string; applicationId?: string }> {
  checkNewPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  return db.transaction().execute(async (trx) => {
    if (options.approval) {
      const waiting = await trx
        .selectFrom('applications')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('decision', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(waiting.n) >= options.maxPending) {
        throw new SignupRefused('Sign-up is paused: too many applications are waiting. Try later.');
      }
    }
    const principalId = await insertPasswordUser(
      trx,
      issuer,
      { ...input, emailVerified: false, status: options.approval ? 'pending' : 'active' },
      passwordHash,
    );
    if (!options.approval) return { principalId };
    const application = await trx
      .insertInto('applications')
      .values({ principal_id: principalId, note: input.note?.trim() || null })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { principalId, applicationId: application.id };
  });
}
