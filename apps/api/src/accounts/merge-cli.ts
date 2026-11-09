/**
 * Merges two accounts (ADR 0028), for an operator who has established that
 * they are one person. Works in either auth mode; it needs only DATABASE_URL.
 *
 *   node dist/accounts/merge-cli.js --survivor you@example.org --loser <id|login|verified email> [--yes]
 *
 * Without --yes it only says what would happen. The merge cannot be undone.
 */
import { parseArgs } from 'node:util';
import { createDb } from '../db/index.js';
import { findAccount, mergeAccounts } from './merge.js';

const { values } = parseArgs({
  options: {
    survivor: { type: 'string' },
    loser: { type: 'string' },
    yes: { type: 'boolean', default: false },
  },
});
const url = process.env['DATABASE_URL'];
if (!url || !values.survivor || !values.loser) {
  console.error(
    'Usage: merge-cli.js --survivor <who> --loser <who> [--yes]  (DATABASE_URL must be set)',
  );
  process.exit(2);
}
const db = createDb(url);
let code = 0;
try {
  const survivor = await findAccount(db, values.survivor);
  const loser = await findAccount(db, values.loser);
  if (!survivor) throw new Error(`No account matches ${values.survivor}`);
  if (!loser) throw new Error(`No account matches ${values.loser}`);
  const describe = async (id: string): Promise<string> => {
    const user = await db
      .selectFrom('users')
      .select(['display_name', 'email'])
      .where('principal_id', '=', id)
      .executeTakeFirstOrThrow();
    const n = await db
      .selectFrom('annotations')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('created_by', '=', id)
      .executeTakeFirstOrThrow();
    return `${user.display_name ?? '(no name)'} <${user.email ?? 'no email'}> ${id}, ${n.n} annotations`;
  };
  console.log(`Keep:   ${await describe(survivor)}\nRemove: ${await describe(loser)}`);
  if (!values.yes) {
    console.log('Nothing done. Repeat with --yes to merge; this cannot be undone.');
    code = 2;
  } else {
    const result = await db
      .transaction()
      .execute((trx) => mergeAccounts(trx, survivor, loser, null));
    console.log(
      `Merged: ${result.annotations} annotations and ${result.identities} sign-in identities moved.`,
    );
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await db.destroy();
}
process.exit(code);
