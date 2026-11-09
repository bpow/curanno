import type { Kysely } from 'kysely';
import type { components } from '@curanno/api-client';
import { decideApplication } from '../accounts/applications.js';
import { requireAdmin } from '../auth/plugin.js';
import { isoDate } from '../annotations/serialize.js';
import type { Database } from '../db/index.js';
import { conflict, notFound } from '../problems.js';
import type { AppContext, Handlers } from './context.js';

type Application = components['schemas']['Application'];
type Decision = components['schemas']['ApplicationDecision'];

function applications(db: Kysely<Database>) {
  return db
    .selectFrom('applications')
    .innerJoin('users', 'users.principal_id', 'applications.principal_id')
    .select((eb) => [
      'applications.id',
      'applications.principal_id',
      'applications.note',
      'applications.created_at',
      'applications.decision',
      'applications.decided_at',
      'applications.decided_by',
      'applications.decision_note',
      'users.display_name',
      'users.email',
      eb
        .exists(
          eb
            .selectFrom('user_emails')
            .select('user_emails.principal_id')
            .whereRef('user_emails.principal_id', '=', 'applications.principal_id')
            .where('user_emails.verified_at', 'is not', null),
        )
        .as('email_verified'),
    ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof applications>['execute']>>[number];

const toApplication = (row: Row): Application => ({
  id: row.id,
  userId: row.principal_id,
  ...(row.display_name !== null ? { displayName: row.display_name } : {}),
  ...(row.email !== null ? { email: row.email } : {}),
  emailVerified: Boolean(row.email_verified),
  ...(row.note !== null ? { note: row.note } : {}),
  created: isoDate(row.created_at),
  decision: row.decision ?? 'pending',
  ...(row.decided_at !== null ? { decided: isoDate(row.decided_at) } : {}),
  ...(row.decided_by !== null ? { decidedBy: row.decided_by } : {}),
  ...(row.decision_note !== null ? { decisionNote: row.decision_note } : {}),
});

export function applicationHandlers(ctx: AppContext): Handlers {
  const { db } = ctx;

  async function load(id: string): Promise<Application> {
    const row = await applications(db).where('applications.id', '=', id).executeTakeFirst();
    if (!row) throw notFound(`no application ${id}`);
    return toApplication(row);
  }

  return {
    async listApplications(request) {
      requireAdmin(request);
      const { decision, limit, offset } = request.query as {
        decision?: 'pending' | 'approved' | 'rejected';
        limit: number;
        offset: number;
      };
      const filtered = (q: ReturnType<typeof applications>) =>
        decision === undefined
          ? q
          : decision === 'pending'
            ? q.where('applications.decision', 'is', null)
            : q.where('applications.decision', '=', decision);
      const total = await filtered(applications(db))
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await filtered(applications(db))
        .orderBy('applications.created_at')
        .orderBy('applications.id')
        .limit(limit)
        .offset(offset)
        .execute();
      return { total: Number(total.n), items: rows.map(toApplication) };
    },

    async getApplication(request) {
      requireAdmin(request);
      return load((request.params as { id: string }).id);
    },

    async decideApplication(request) {
      const caller = requireAdmin(request);
      const { id } = request.params as { id: string };
      const { decision, note } = request.body as Decision;
      const result = await decideApplication(db, id, decision, caller.userId, note);
      if (result.outcome === 'missing') throw notFound(`no application ${id}`);
      if (result.outcome === 'already-decided')
        throw conflict('This application was already decided');
      const application = await load(id);
      if (ctx.accountMail && application.email) {
        await ctx.accountMail
          .decided(application.email, decision, note)
          .catch((err: unknown) => request.log.warn({ err }, 'mailing the decision failed'));
      }
      return application;
    },
  };
}
