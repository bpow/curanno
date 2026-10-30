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

export interface CallerOptions {
  adminGroup?: string | undefined;
}

/**
 * Map a validated token to a user, creating the user on first sight and
 * synchronizing the `groups` claim into provider-managed groups.
 */
export async function resolveCaller(
  db: Kysely<Database>,
  claims: TokenClaims,
  options: CallerOptions = {},
): Promise<UserCaller> {
  return db.transaction().execute(async (trx) => {
    const user = await upsertUser(trx, claims);
    await syncGroups(trx, user.principal_id, claims);
    let isAdmin = user.is_admin;
    if (options.adminGroup !== undefined) {
      isAdmin = claims.groups.includes(options.adminGroup);
      if (isAdmin !== user.is_admin) {
        await trx
          .updateTable('users')
          .set({ is_admin: isAdmin })
          .where('principal_id', '=', user.principal_id)
          .execute();
      }
    }
    const groups = await trx
      .selectFrom('group_memberships')
      .select('group_id')
      .where('user_id', '=', user.principal_id)
      .execute();
    return {
      kind: 'user',
      userId: user.principal_id,
      displayName: user.display_name ?? undefined,
      isAdmin,
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

async function upsertUser(
  trx: Kysely<Database>,
  claims: TokenClaims,
): Promise<{ principal_id: string; display_name: string | null; is_admin: boolean }> {
  const existing = await trx
    .selectFrom('users')
    .select(['principal_id', 'display_name', 'is_admin'])
    .where('issuer', '=', claims.issuer)
    .where('subject', '=', claims.subject)
    .executeTakeFirst();
  if (existing) {
    const updated = await trx
      .updateTable('users')
      .set({
        display_name: claims.name ?? existing.display_name,
        email: claims.email ?? null,
        last_login_at: sql`now()`,
      })
      .where('principal_id', '=', existing.principal_id)
      .returning(['principal_id', 'display_name', 'is_admin'])
      .executeTakeFirstOrThrow();
    return updated;
  }
  const principal = await trx
    .insertInto('principals')
    .values({ kind: 'user' })
    .returning('id')
    .executeTakeFirstOrThrow();
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
  if (inserted) return inserted;
  // Lost a race with a concurrent first login: drop the spare principal and use theirs.
  await trx.deleteFrom('principals').where('id', '=', principal.id).execute();
  return trx
    .selectFrom('users')
    .select(['principal_id', 'display_name', 'is_admin'])
    .where('issuer', '=', claims.issuer)
    .where('subject', '=', claims.subject)
    .executeTakeFirstOrThrow();
}

/**
 * Make the user's memberships in groups managed by this issuer equal to the
 * claim. Groups are matched by name among the groups this issuer owns; a
 * claimed name that no such group has yet creates one. Groups created
 * through the API are never matched, so a claim cannot grant membership in
 * them whatever they are called (migration 0008).
 */
async function syncGroups(
  trx: Kysely<Database>,
  userId: string,
  claims: TokenClaims,
): Promise<void> {
  const groupIds: string[] = [];
  for (const name of claims.groups) {
    let group = await trx
      .selectFrom('groups')
      .select('principal_id')
      .where('issuer', '=', claims.issuer)
      .where(sql`lower(name)`, '=', name.toLowerCase())
      .executeTakeFirst();
    if (!group) {
      const principal = await trx
        .insertInto('principals')
        .values({ kind: 'group' })
        .returning('id')
        .executeTakeFirstOrThrow();
      group = await trx
        .insertInto('groups')
        .values({
          principal_id: principal.id,
          name,
          description: null,
          issuer: claims.issuer,
          created_by: null,
        })
        .onConflict((oc) => oc.expression(sql`coalesce(issuer, ''), lower(name)`).doNothing())
        .returning('principal_id')
        .executeTakeFirst();
      if (!group) {
        await trx.deleteFrom('principals').where('id', '=', principal.id).execute();
        group = await trx
          .selectFrom('groups')
          .select('principal_id')
          .where('issuer', '=', claims.issuer)
          .where(sql`lower(name)`, '=', name.toLowerCase())
          .executeTakeFirstOrThrow();
      }
    }
    groupIds.push(group.principal_id);
    await trx
      .insertInto('group_memberships')
      .values({ group_id: group.principal_id, user_id: userId, added_by: null })
      .onConflict((oc) => oc.columns(['group_id', 'user_id']).doNothing())
      .execute();
  }
  let stale = trx
    .deleteFrom('group_memberships')
    .where('user_id', '=', userId)
    .where('group_id', 'in', (qb) =>
      qb.selectFrom('groups').select('principal_id').where('issuer', '=', claims.issuer),
    );
  if (groupIds.length > 0) stale = stale.where('group_id', 'not in', groupIds);
  await stale.execute();
}
