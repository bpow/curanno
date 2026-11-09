/**
 * Applications to join (ADR 0028): what the embedded sign-up with approval
 * records, and the decision on it. Used by the administrators' API and by the
 * automatic approval of a verified address.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/index.js';

export type Outcome = 'decided' | 'already-decided' | 'missing';

/** Records the decision and moves the applicant to `active` or `rejected`; a decision is made once. */
export async function decideApplication(
  db: Kysely<Database>,
  id: string,
  decision: 'approved' | 'rejected',
  decidedBy: string | null,
  note: string | undefined,
): Promise<{ outcome: Outcome; principalId?: string }> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('applications')
      .set({
        decision,
        decided_at: sql`now()`,
        decided_by: decidedBy,
        decision_note: note ?? null,
      })
      .where('id', '=', id)
      .where('decision', 'is', null)
      .returning('principal_id')
      .executeTakeFirst();
    if (!row) {
      const exists = await trx
        .selectFrom('applications')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      return { outcome: exists ? 'already-decided' : 'missing' };
    }
    await trx
      .updateTable('users')
      .set({ status: decision === 'approved' ? 'active' : 'rejected' })
      .where('principal_id', '=', row.principal_id)
      .where('status', '=', 'pending')
      .execute();
    return { outcome: 'decided', principalId: row.principal_id };
  });
}

/** Removes what is no longer needed: rejected applicants after `retentionDays`, and pending ones nobody verified or decided for `staleDays`. */
export async function purgeApplications(
  db: Kysely<Database>,
  options: { retentionDays: number; staleDays: number },
): Promise<number> {
  const day = 24 * 3600_000;
  const rejectedBefore = new Date(Date.now() - options.retentionDays * day);
  const staleBefore = new Date(Date.now() - options.staleDays * day);
  const doomed = await db
    .selectFrom('applications')
    .innerJoin('users', 'users.principal_id', 'applications.principal_id')
    .select('applications.principal_id')
    .where('users.status', 'in', ['pending', 'rejected'])
    .where((eb) =>
      eb.or([
        eb.and([
          eb('applications.decision', '=', 'rejected'),
          eb('applications.decided_at', '<', rejectedBefore),
        ]),
        eb.and([
          eb('applications.decision', 'is', null),
          eb('applications.created_at', '<', staleBefore),
        ]),
      ]),
    )
    .execute();
  if (doomed.length === 0) return 0;
  // Principals own the user row, which owns the application, credentials and addresses.
  await db
    .deleteFrom('principals')
    .where(
      'id',
      'in',
      doomed.map((d) => d.principal_id),
    )
    .execute();
  return doomed.length;
}
