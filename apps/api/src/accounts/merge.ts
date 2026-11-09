/**
 * Folding one account into another (ADR 0028): for a person who ended up
 * with two, say a password account and a Google sign-in nobody linked. The
 * loser's annotations, permissions, memberships and sign-in methods become
 * the survivor's, and the loser is deleted, in one transaction.
 *
 * Every column that references a user or a principal is accounted for in
 * `HANDLING`, and a test compares it with the database's own foreign keys, so
 * a table added later that points at users cannot be forgotten.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/index.js';

/**
 * What happens to the rows of the loser, by `table.column`:
 * - `moved`: the column is set to the survivor.
 * - `merged`: moved where that does not clash with what the survivor has, the
 *   rest dropped (or, for memberships, the stronger role kept).
 * - `dropped`: belongs to the loser alone and goes with them (cascade).
 * - `self`: the loser's own row.
 */
export const HANDLING: Record<string, 'moved' | 'merged' | 'dropped' | 'self'> = {
  'users.principal_id': 'self',
  'identities.principal_id': 'moved',
  'linked_accounts.principal_id': 'moved',
  'credentials.principal_id': 'merged',
  'user_emails.principal_id': 'merged',
  'annotations.created_by': 'moved',
  'annotation_events.actor_id': 'moved',
  'acl.principal_id': 'merged',
  'acl.granted_by': 'moved',
  'groups.principal_id': 'self',
  'groups.created_by': 'moved',
  'group_memberships.user_id': 'merged',
  'group_memberships.added_by': 'moved',
  'body_profiles.created_by': 'moved',
  'account_tokens.created_by': 'moved',
  'account_tokens.principal_id': 'dropped',
  'auth_events.principal_id': 'moved',
  'applications.principal_id': 'dropped',
  'applications.decided_by': 'moved',
  'upstream_attempts.principal_id': 'dropped',
  'pending_links.principal_id': 'dropped',
  'login_tickets.principal_id': 'dropped',
};

export class MergeError extends Error {}

export interface MergeResult {
  annotations: number;
  identities: number;
}

/**
 * Moves everything of `loser` to `survivor` and deletes `loser`. Run inside a
 * transaction. The loser's `(issuer, subject)` identities now lead to the
 * survivor, so a token issued to the loser keeps working as the survivor.
 */
export async function mergeAccounts(
  trx: Kysely<Database>,
  survivor: string,
  loser: string,
  actorId: string | null,
): Promise<MergeResult> {
  if (survivor === loser) throw new MergeError('An account cannot be merged into itself');
  const users = await trx
    .selectFrom('users')
    .select(['principal_id', 'is_admin'])
    .where('principal_id', 'in', [survivor, loser])
    .forUpdate()
    .execute();
  const from = users.find((u) => u.principal_id === loser);
  const into = users.find((u) => u.principal_id === survivor);
  if (!from || !into) throw new MergeError('Both accounts must exist');

  // Sign-in methods.
  const identities = await trx
    .updateTable('identities')
    .set({ principal_id: survivor })
    .where('principal_id', '=', loser)
    .executeTakeFirst();
  await trx
    .updateTable('linked_accounts')
    .set({ principal_id: survivor })
    .where('principal_id', '=', loser)
    .execute();
  // One password per account: the survivor's stays; without one the loser's comes along.
  const hasPassword = await trx
    .selectFrom('credentials')
    .select('principal_id')
    .where('principal_id', '=', survivor)
    .executeTakeFirst();
  if (!hasPassword) {
    await trx
      .updateTable('credentials')
      .set({ principal_id: survivor })
      .where('principal_id', '=', loser)
      .execute();
  }
  // Addresses the survivor does not have yet, keeping whether they were verified; none is primary.
  await trx
    .updateTable('user_emails')
    .set({ principal_id: survivor, is_primary: false })
    .where('principal_id', '=', loser)
    .where(
      sql`lower(email)`,
      'not in',
      trx
        .selectFrom('user_emails')

        .select(sql<string>`lower(email)`.as('e'))
        .where('principal_id', '=', survivor),
    )
    .execute();

  // Work.
  const moved = await trx
    .updateTable('annotations')
    .set({ created_by: survivor })
    .where('created_by', '=', loser)
    .returning(['id', 'document_id'])
    .execute();
  // Permissions granted to the loser: those the survivor lacks are re-pointed; the rest are already theirs.
  await trx
    .updateTable('acl')
    .set({ principal_id: survivor })
    .where('principal_id', '=', loser)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('acl as mine')
            .select('mine.principal_id')
            .whereRef('mine.annotation_id', '=', 'acl.annotation_id')
            .whereRef('mine.permission', '=', 'acl.permission')
            .where('mine.principal_id', '=', survivor),
        ),
      ),
    )
    .execute();
  // Memberships: where both belong, the stronger role wins.
  await trx
    .updateTable('group_memberships')
    .set({ role: 'admin' })
    .where('user_id', '=', survivor)
    .where(
      'group_id',
      'in',
      trx
        .selectFrom('group_memberships')
        .select('group_id')
        .where('user_id', '=', loser)
        .where('role', '=', 'admin'),
    )
    .execute();
  await trx
    .updateTable('group_memberships')
    .set({ user_id: survivor })
    .where('user_id', '=', loser)
    .where(
      'group_id',
      'not in',
      trx.selectFrom('group_memberships').select('group_id').where('user_id', '=', survivor),
    )
    .execute();
  for (const [table, column] of [
    ['annotation_events', 'actor_id'],
    ['acl', 'granted_by'],
    ['groups', 'created_by'],
    ['group_memberships', 'added_by'],
    ['body_profiles', 'created_by'],
    ['account_tokens', 'created_by'],
    ['auth_events', 'principal_id'],
    ['applications', 'decided_by'],
  ] as const) {
    await sql`update ${sql.table(table)} set ${sql.ref(column)} = ${survivor} where ${sql.ref(column)} = ${loser}`.execute(
      trx,
    );
  }
  if (moved.length > 0) {
    // Their creator changed, so anyone watching them is told.
    await trx
      .insertInto('annotation_events')
      .values(
        moved.map((a) => ({
          annotation_id: a.id,
          document_id: a.document_id,
          kind: 'updated' as const,
          actor_id: actorId === loser ? survivor : actorId,
        })),
      )
      .execute();
  }

  // The survivor is an administrator if either was.
  if (from.is_admin && !into.is_admin) {
    await trx
      .updateTable('users')
      .set({ is_admin: true })
      .where('principal_id', '=', survivor)
      .execute();
  }
  // Sessions of the loser end; what is left of them (cascade) goes with the principal.
  await sql`delete from oidc_store where payload->>'accountId' = ${loser}`.execute(trx);
  await trx.deleteFrom('principals').where('id', '=', loser).execute();
  await trx
    .insertInto('auth_events')
    .values({
      kind: 'accounts-merged',
      principal_id: survivor,
      key: null,
      detail: `merged ${loser}${actorId ? ` by ${actorId}` : ''}`,
    })
    .execute();
  return { annotations: moved.length, identities: Number(identities.numUpdatedRows) };
}

/** Finds a user by id, login, or verified email, for the operator who names them. */
export async function findAccount(db: Kysely<Database>, who: string): Promise<string | undefined> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(who)) {
    const row = await db
      .selectFrom('users')
      .select('principal_id')
      .where('principal_id', '=', who)
      .executeTakeFirst();
    return row?.principal_id;
  }
  const wanted = who.trim().toLowerCase();
  const byLogin = await db
    .selectFrom('credentials')
    .select('principal_id')
    .where(sql`lower(login)`, '=', wanted)
    .executeTakeFirst();
  if (byLogin) return byLogin.principal_id;
  const byEmail = await db
    .selectFrom('user_emails')
    .select('principal_id')
    .where(sql`lower(email)`, '=', wanted)
    .where('verified_at', 'is not', null)
    .executeTakeFirst();
  return byEmail?.principal_id;
}
