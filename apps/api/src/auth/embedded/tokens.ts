/**
 * Single-use links with a secret in them. The secret is 256 random bits; the
 * database keeps only its SHA-256, so it cannot be read back from a dump.
 * Consuming one is a single conditional update, so two requests with the same
 * link cannot both succeed.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { AccountTokenPurpose, Database } from '../../db/schema.js';

export const TTL_MS: Record<AccountTokenPurpose, number> = {
  invite: 7 * 24 * 3600_000,
  reset: 3600_000,
  verify: 2 * 24 * 3600_000,
};

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface NewToken {
  purpose: AccountTokenPurpose;
  email: string;
  principalId?: string | undefined;
  isAdmin?: boolean | undefined;
  createdBy?: string | undefined;
}

/** Stores a new token and returns the secret to put in the link. */
export async function createToken(db: Kysely<Database>, input: NewToken): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db
    .insertInto('account_tokens')
    .values({
      token_hash: hash(token),
      purpose: input.purpose,
      email: input.email,
      principal_id: input.principalId ?? null,
      is_admin: input.isAdmin ?? false,
      created_by: input.createdBy ?? null,
      expires_at: new Date(Date.now() + TTL_MS[input.purpose]),
    })
    .execute();
  return token;
}

export interface ConsumedToken {
  email: string;
  principalId: string | null;
  isAdmin: boolean;
}

/** Marks the token used and returns what it was for; undefined when it is unknown, used or expired. */
export async function consumeToken(
  db: Kysely<Database>,
  purpose: AccountTokenPurpose,
  token: string,
): Promise<ConsumedToken | undefined> {
  const row = await db
    .updateTable('account_tokens')
    .set({ used_at: sql`now()` })
    .where('token_hash', '=', hash(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .returning(['email', 'principal_id', 'is_admin'])
    .executeTakeFirst();
  return row && { email: row.email, principalId: row.principal_id, isAdmin: row.is_admin };
}

/** What a token would do, without using it, for the page that asks the user to proceed. */
export async function peekToken(
  db: Kysely<Database>,
  purpose: AccountTokenPurpose,
  token: string,
): Promise<{ email: string } | undefined> {
  return db
    .selectFrom('account_tokens')
    .select('email')
    .where('token_hash', '=', hash(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .executeTakeFirst();
}

export async function purgeTokens(db: Kysely<Database>): Promise<number> {
  const result = await db
    .deleteFrom('account_tokens')
    .where('expires_at', '<', new Date(Date.now() - 7 * 24 * 3600_000))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
