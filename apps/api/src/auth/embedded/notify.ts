import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Mailer } from './mail.js';

/** A line to the administrators that someone waits; the queue is also on the applications page. */
export async function tellAdministrators(
  db: Kysely<Database>,
  mailer: Mailer | undefined,
  origin: string,
  applicant: { name: string; email: string | undefined; note: string | undefined },
): Promise<void> {
  if (!mailer) return;
  const admins = await db
    .selectFrom('users')
    .select('email')
    .where('is_admin', '=', true)
    .where('status', '=', 'active')
    .where('email', 'is not', null)
    .limit(10)
    .execute();
  const who = applicant.email ? `${applicant.name} <${applicant.email}>` : applicant.name;
  for (const admin of admins) {
    if (!admin.email) continue;
    await mailer.send({
      to: admin.email,
      subject: `${applicant.name} asks to join curanno`,
      text: `${who} applied for an account.${applicant.note ? `\n\nThey wrote: ${applicant.note}` : ''}\n\nDecide at ${origin}/applications\n`,
    });
  }
}
