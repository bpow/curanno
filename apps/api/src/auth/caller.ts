/**
 * Who is making a request, as the ACL sees it (ADR 0006). Anonymous callers
 * act as the `public` principal; a user acts as themself, `authenticated`,
 * `public` and every group they belong to.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { AUTHENTICATED_PRINCIPAL_ID, PUBLIC_PRINCIPAL_ID, type Database } from '../db/index.js';
import type { TokenClaims } from './verifier.js';

export interface AnonymousCaller {
  kind: 'anonymous';
  principalIds: string[];
}

export interface UserCaller {
  kind: 'user';
  userId: string;
  displayName: string | undefined;
  isAdmin: boolean;
  principalIds: string[];
  /** When the token behind this caller expires, in milliseconds since the epoch; absent when it never does. */
  expiresAt?: number;
}

export type Caller = AnonymousCaller | UserCaller;

export const ANONYMOUS: AnonymousCaller = {
  kind: 'anonymous',
  principalIds: [PUBLIC_PRINCIPAL_ID],
};

export interface ResolveOptions {
  /**
   * Whether the token's name and email replace the stored ones at each
   * request. They do for an external issuer, which owns the profile. The
   * embedded issuer's tokens are made from the stored profile, so a token
   * issued before an edit would undo it.
   */
  profileFromToken?: boolean;
}

/**
 * Map a validated token to a user, creating the user on first sight. Group
 * membership is managed entirely through our own group API (ADR 0010); the
 * token is used only to establish identity.
 */
export async function resolveCaller(
  db: Kysely<Database>,
  claims: TokenClaims,
  options: ResolveOptions = {},
): Promise<UserCaller> {
  return db.transaction().execute(async (trx) => {
    const user = await upsertUser(trx, claims, options.profileFromToken ?? true);
    const groups = await trx
      .selectFrom('group_memberships')
      .select('group_id')
      .where('user_id', '=', user.principal_id)
      .execute();
    return {
      kind: 'user',
      userId: user.principal_id,
      displayName: user.display_name ?? undefined,
      isAdmin: user.is_admin,
      principalIds: principalsOf(
        user.principal_id,
        groups.map((g) => g.group_id),
      ),
      ...(claims.expiresAt !== undefined ? { expiresAt: claims.expiresAt * 1000 } : {}),
    };
  });
}

function principalsOf(userId: string, groupIds: string[]): string[] {
  return [userId, AUTHENTICATED_PRINCIPAL_ID, PUBLIC_PRINCIPAL_ID, ...groupIds];
}

/**
 * The caller as the database now has them: memberships and the admin flag
 * reloaded, so that a long-lived request (an event stream) does not keep
 * permissions the user lost. Undefined when the user no longer exists.
 */
export async function refreshCaller(
  db: Kysely<Database>,
  caller: UserCaller,
): Promise<UserCaller | undefined> {
  const user = await db
    .selectFrom('users')
    .select(['display_name', 'is_admin'])
    .where('principal_id', '=', caller.userId)
    .executeTakeFirst();
  if (!user) return undefined;
  const groups = await db
    .selectFrom('group_memberships')
    .select('group_id')
    .where('user_id', '=', caller.userId)
    .execute();
  return {
    ...caller,
    displayName: user.display_name ?? undefined,
    isAdmin: user.is_admin,
    principalIds: principalsOf(
      caller.userId,
      groups.map((g) => g.group_id),
    ),
  };
}

type UserRow = { principal_id: string; display_name: string | null; is_admin: boolean };

/**
 * The user an identity belongs to. A user the previous release created has
 * no identity row yet, only the issuer and subject on `users`; it is adopted
 * here (ADR 0028, migration 0012).
 */
async function findUserId(trx: Kysely<Database>, claims: TokenClaims): Promise<string | undefined> {
  const identity = await trx
    .selectFrom('identities')
    .select('principal_id')
    .where('issuer', '=', claims.issuer)
    .where('subject', '=', claims.subject)
    .executeTakeFirst();
  if (identity) return identity.principal_id;
  const legacy = await trx
    .selectFrom('users')
    .select('principal_id')
    .where('issuer', '=', claims.issuer)
    .where('subject', '=', claims.subject)
    .executeTakeFirst();
  if (!legacy) return undefined;
  await trx
    .insertInto('identities')
    .values({
      issuer: claims.issuer,
      subject: claims.subject,
      principal_id: legacy.principal_id,
    })
    .onConflict((oc) => oc.columns(['issuer', 'subject']).doNothing())
    .execute();
  return legacy.principal_id;
}

async function upsertUser(
  trx: Kysely<Database>,
  claims: TokenClaims,
  profileFromToken: boolean,
): Promise<UserRow> {
  const existingId = await findUserId(trx, claims);
  if (existingId) return touchUser(trx, existingId, claims, profileFromToken);
  const principal = await trx
    .insertInto('principals')
    .values({ kind: 'user' })
    .returning('id')
    .executeTakeFirstOrThrow();
  // issuer and subject stay on `users` for pods of the previous release.
  const inserted = await trx
    .insertInto('users')
    .values({
      principal_id: principal.id,
      issuer: claims.issuer,
      subject: claims.subject,
      display_name: claims.name ?? null,
      email: claims.email ?? null,
      last_login_at: sql`now()`,
    })
    .onConflict((oc) => oc.columns(['issuer', 'subject']).doNothing())
    .returning(['principal_id', 'display_name', 'is_admin'])
    .executeTakeFirst();
  if (inserted) {
    await trx
      .insertInto('identities')
      .values({
        issuer: claims.issuer,
        subject: claims.subject,
        principal_id: inserted.principal_id,
        last_login_at: sql`now()`,
      })
      .execute();
    return inserted;
  }
  // Lost a race with a concurrent first login: drop the spare principal and use theirs.
  await trx.deleteFrom('principals').where('id', '=', principal.id).execute();
  const winner = await findUserId(trx, claims);
  if (!winner) throw new Error('user vanished after a concurrent first login');
  return touchUser(trx, winner, claims, profileFromToken);
}

async function touchUser(
  trx: Kysely<Database>,
  principalId: string,
  claims: TokenClaims,
  profileFromToken: boolean,
): Promise<UserRow> {
  await trx
    .updateTable('identities')
    .set({ last_login_at: sql`now()` })
    .where('issuer', '=', claims.issuer)
    .where('subject', '=', claims.subject)
    .execute();
  return trx
    .updateTable('users')
    .set({
      ...(profileFromToken
        ? {
            display_name: sql`coalesce(${claims.name ?? null}::text, display_name)`,
            email: claims.email ?? null,
          }
        : {}),
      last_login_at: sql`now()`,
    })
    .where('principal_id', '=', principalId)
    .returning(['principal_id', 'display_name', 'is_admin'])
    .executeTakeFirstOrThrow();
}
