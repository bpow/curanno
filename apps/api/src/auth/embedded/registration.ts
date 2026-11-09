/** Account and application records shared by password and upstream registration. */
import { sql, type Transaction } from 'kysely';
import type { Database, UserStatus } from '../../db/schema.js';

export interface NewAccount {
  displayName?: string | undefined;
  email?: string | undefined;
  /** The operator, an invitation or a provider has vouched for the address. */
  emailVerified?: boolean | undefined;
  isAdmin?: boolean | undefined;
  /** `active` unless the user must wait for approval. */
  status?: UserStatus | undefined;
}

/** Creates the principal, local identity and initial address in the caller's transaction. */
export async function insertAccount(
  trx: Transaction<Database>,
  issuer: string,
  input: NewAccount,
): Promise<string> {
  const principal = await trx
    .insertInto('principals')
    .values({ kind: 'user' })
    .returning('id')
    .executeTakeFirstOrThrow();
  // Keep issuer and subject for pods of the previous release (migration 0012).
  await trx
    .insertInto('users')
    .values({
      principal_id: principal.id,
      issuer,
      subject: principal.id,
      display_name: input.displayName ?? null,
      email: input.email ?? null,
      is_admin: input.isAdmin ?? false,
      status: input.status ?? 'active',
    })
    .execute();
  await trx
    .insertInto('identities')
    .values({ issuer, subject: principal.id, principal_id: principal.id })
    .execute();
  if (input.email) {
    await trx
      .insertInto('user_emails')
      .values({
        principal_id: principal.id,
        email: input.email,
        verified_at: input.emailVerified ? new Date() : null,
        is_primary: Boolean(input.emailVerified),
      })
      .execute();
  }
  return principal.id;
}

/** Whether another pending application would exceed the configured queue. */
export async function applicationQueueFull(
  trx: Transaction<Database>,
  maxPending: number,
): Promise<boolean> {
  const waiting = await trx
    .selectFrom('applications')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('decision', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(waiting.n) >= maxPending;
}

/** Records either a pending application or the rule that approved it. */
export async function recordApplication(
  trx: Transaction<Database>,
  principalId: string,
  input: { note?: string | undefined; approved?: boolean; decisionNote?: string },
): Promise<string> {
  const row = await trx
    .insertInto('applications')
    .values({
      principal_id: principalId,
      note: input.note?.trim() || null,
      ...(input.approved
        ? {
            decision: 'approved' as const,
            decided_at: sql`now()`,
            decision_note: input.decisionNote ?? null,
          }
        : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
