/**
 * Invitations, and the mail that carries links. An invitation lets the person
 * at an address create an account (as an administrator if the invitation says
 * so) without waiting for approval; it is how the first administrator comes
 * to exist and how a closed deployment adds people.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { AccountError } from './accounts.js';
import type { Mailer } from './mail.js';
import { createToken } from './tokens.js';

export function accountLink(publicUrl: string, page: string, token: string): string {
  return `${publicUrl}/account/${page}?token=${encodeURIComponent(token)}`;
}

/** Whether an account already answers to `email`, as its login or as a verified address. */
export async function addressInUse(db: Kysely<Database>, email: string): Promise<boolean> {
  const wanted = email.toLowerCase();
  const login = await db
    .selectFrom('credentials')
    .select('principal_id')
    .where(sql`lower(login)`, '=', wanted)
    .executeTakeFirst();
  if (login) return true;
  const verified = await db
    .selectFrom('user_emails')
    .select('principal_id')
    .where(sql`lower(email)`, '=', wanted)
    .where('verified_at', 'is not', null)
    .executeTakeFirst();
  return verified !== undefined;
}

/** Creates the invitation and returns its link. */
export async function createInvite(
  db: Kysely<Database>,
  publicUrl: string,
  input: { email: string; isAdmin?: boolean; createdBy?: string },
): Promise<string> {
  const email = input.email.trim();
  if (await addressInUse(db, email)) throw new AccountError(`${email} already has an account`);
  const token = await createToken(db, {
    purpose: 'invite',
    email,
    isAdmin: input.isAdmin,
    createdBy: input.createdBy,
  });
  return accountLink(publicUrl, 'invite', token);
}

export async function mailInvite(mailer: Mailer, email: string, link: string): Promise<void> {
  await mailer.send({
    to: email,
    subject: 'You are invited to curanno',
    text: `You have been invited to create an account.\n\nChoose a password here (the link works once, for a week):\n${link}\n`,
  });
}

/**
 * While no administrator exists, invites the configured address to become
 * one. With mail it is sent; without, the link goes to the log, which only
 * the operator reads. An invitation still waiting is not repeated.
 */
export async function ensureBootstrapAdmin(
  db: Kysely<Database>,
  options: {
    email: string;
    publicUrl: string;
    mailer: Mailer | undefined;
    log: { info(message: string): void };
  },
): Promise<void> {
  const admin = await db
    .selectFrom('users')
    .select('principal_id')
    .where('is_admin', '=', true)
    .executeTakeFirst();
  if (admin) return;
  const waiting = await db
    .selectFrom('account_tokens')
    .select('token_hash')
    .where('purpose', '=', 'invite')
    .where('is_admin', '=', true)
    .where('email', '=', options.email)
    .where('used_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .executeTakeFirst();
  if (waiting) return;
  if (await addressInUse(db, options.email)) return;
  const link = await createInvite(db, options.publicUrl, { email: options.email, isAdmin: true });
  if (options.mailer) {
    await mailInvite(options.mailer, options.email, link);
    options.log.info(`Invited ${options.email} to become the first administrator, by mail.`);
  } else {
    options.log.info(`No administrator yet. ${options.email} can create the account at: ${link}`);
  }
}
