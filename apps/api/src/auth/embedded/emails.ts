/** Verified addresses and primary selection, shared by account links and upstream providers. */
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../db/schema.js';

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
  trx: Transaction<Database>,
  principalId: string,
  email: string,
  options: { addIfMissing?: boolean } = {},
): Promise<boolean> {
  if (!(await lockAccount(trx, principalId))) return false;
  const taken = await trx
    .selectFrom('user_emails')
    .select('principal_id')
    .where(sql`lower(email)`, '=', email.toLowerCase())
    .where('verified_at', 'is not', null)
    .where('principal_id', '<>', principalId)
    .executeTakeFirst();
  if (taken) return false;
  // A provider can introduce an address; a mailed link can only verify one still on the account.
  if (options.addIfMissing) await addEmail(trx, principalId, email);
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
  if (!hasPrimary) await setPrimary(trx, principalId, email);
  return true;
}

/** Makes a verified address the one the user's tokens carry. */
export async function makePrimary(
  trx: Transaction<Database>,
  principalId: string,
  email: string,
): Promise<boolean> {
  if (!(await lockAccount(trx, principalId))) return false;
  return setPrimary(trx, principalId, email);
}

async function setPrimary(
  trx: Transaction<Database>,
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
  trx: Transaction<Database>,
  principalId: string,
  email: string,
): Promise<boolean> {
  if (!(await lockAccount(trx, principalId))) return false;
  const result = await trx
    .deleteFrom('user_emails')
    .where('principal_id', '=', principalId)
    .where(sql`lower(email)`, '=', email.toLowerCase())
    .where('is_primary', '=', false)
    .executeTakeFirst();
  return result.numDeletedRows > 0n;
}

/** Serialize verification, selection and removal so the profile always names the primary address. */
async function lockAccount(trx: Transaction<Database>, principalId: string): Promise<boolean> {
  const user = await trx
    .selectFrom('users')
    .select('principal_id')
    .where('principal_id', '=', principalId)
    .forNoKeyUpdate()
    .executeTakeFirst();
  return user !== undefined;
}
