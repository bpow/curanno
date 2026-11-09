/**
 * Signing in and linking through upstream providers (ADR 0028). Everything
 * that decides what an upstream identity may do is here, apart from HTTP: the
 * four outcomes of a callback (known identity; connect while signed in; same
 * verified email as an existing account, which asks for that account's
 * password before attaching anything; a new person, under the sign-up
 * policy), and the one-use records that tie a trip to a provider to the
 * browser that made it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Config, UpstreamProvider } from '../../../config.js';
import type { Database } from '../../../db/schema.js';
import { hashToken } from '../tokens.js';
import { verifyEmail } from '../emails.js';
import { applicationQueueFull, insertAccount, recordApplication } from '../registration.js';
import { createClient, type ProviderClient, type UpstreamProfile } from './clients.js';

export const ATTEMPT_TTL_MS = 10 * 60_000;
export const TICKET_TTL_MS = 2 * 60_000;
export const PENDING_TTL_MS = 10 * 60_000;

/** What the browser is told, as a code the sign-in page words for a person. */
export type UpstreamError =
  | 'expired' // the trip took too long, or was already used
  | 'browser' // another browser started it
  | 'denied' // the person said no at the provider
  | 'failed' // the provider did not give an identity
  | 'disabled' // the account is switched off
  | 'closed' // this deployment takes people by invitation only
  | 'paused' // too many applications wait
  | 'use-existing' // the address has an account with no password to prove it by
  | 'owned'; // another account already has this identity

export type CallbackResult =
  | { kind: 'ticket'; uid: string; ticket: string }
  | { kind: 'pending-link'; uid: string; id: string }
  | { kind: 'connected' }
  | { kind: 'error'; code: UpstreamError; uid?: string | undefined; purpose?: 'login' | 'connect' };

export interface Provider {
  config: UpstreamProvider;
  client: ProviderClient;
}

export interface UpstreamOptions {
  db: Kysely<Database>;
  /** The issuer's origin; the callback addresses are under it. */
  origin: string;
  auth: Pick<
    Config['auth'],
    'signup' | 'autoApproveDomains' | 'maxPending' | 'autolink' | 'providers'
  >;
  /** Replaces the network clients; for tests. */
  clientFor?: (provider: UpstreamProvider) => ProviderClient;
  /** Told when a new person is queued for approval. */
  onApplication?: (applicant: {
    name: string;
    email: string | undefined;
    note: string;
  }) => Promise<void>;
}

const random = (): string => randomBytes(32).toString('base64url');
const later = (ms: number): Date => new Date(Date.now() + ms);

export class Upstream {
  readonly providers: Map<string, Provider>;
  private readonly db: Kysely<Database>;

  constructor(private readonly options: UpstreamOptions) {
    this.db = options.db;
    this.providers = new Map(
      options.auth.providers.map((config) => [
        config.id,
        { config, client: (options.clientFor ?? createClient)(config) },
      ]),
    );
  }

  redirectUri(provider: string): string {
    return `${this.options.origin}/idp/upstream/${provider}/callback`;
  }

  /** The address to send the browser to, having recorded the attempt against `binding`. */
  async start(
    providerId: string,
    attempt: { purpose: 'login'; uid: string } | { purpose: 'connect'; principalId: string },
    binding: string,
  ): Promise<string> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`no provider ${providerId}`);
    const state = random();
    const nonce = random();
    const verifier = random();
    await this.db
      .insertInto('upstream_attempts')
      .values({
        state_hash: hashToken(state),
        provider: providerId,
        purpose: attempt.purpose,
        uid: attempt.purpose === 'login' ? attempt.uid : null,
        principal_id: attempt.purpose === 'connect' ? attempt.principalId : null,
        nonce,
        code_verifier: verifier,
        binding_hash: hashToken(binding),
        expires_at: later(ATTEMPT_TTL_MS),
      })
      .execute();
    return provider.client.authorizeUrl({
      redirectUri: this.redirectUri(providerId),
      state,
      nonce,
      challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
  }

  /** Completes a trip: the attempt is used up whatever happens next. */
  async callback(
    providerId: string,
    callback: URL,
    binding: string | undefined,
  ): Promise<CallbackResult> {
    const params = callback.searchParams;
    const state = params.get('state');
    const provider = this.providers.get(providerId);
    const attempt =
      provider && state
        ? await this.db
            .deleteFrom('upstream_attempts')
            .where('state_hash', '=', hashToken(state))
            .where('provider', '=', providerId)
            .where('expires_at', '>', sql<Date>`now()`)
            .returning(['purpose', 'uid', 'principal_id', 'nonce', 'code_verifier', 'binding_hash'])
            .executeTakeFirst()
        : undefined;
    if (!provider || !attempt || !state) return { kind: 'error', code: 'expired' };
    const where = { uid: attempt.uid ?? undefined, purpose: attempt.purpose };
    if (!binding || hashToken(binding) !== attempt.binding_hash) {
      return { kind: 'error', code: 'browser', ...where };
    }
    if (params.has('error') || !params.get('code'))
      return { kind: 'error', code: 'denied', ...where };
    let profile: UpstreamProfile;
    try {
      profile = await provider.client.exchange({
        redirectUri: this.redirectUri(providerId),
        callback,
        state,
        verifier: attempt.code_verifier,
        nonce: attempt.nonce,
      });
    } catch {
      return { kind: 'error', code: 'failed', ...where };
    }
    if (attempt.purpose === 'connect' && attempt.principal_id) {
      const attached = await this.attach(this.db, attempt.principal_id, providerId, profile);
      return attached ? { kind: 'connected' } : { kind: 'error', code: 'owned', ...where };
    }
    return this.signIn(providerId, profile, attempt.uid ?? '', attempt.binding_hash);
  }

  private async signIn(
    providerId: string,
    profile: UpstreamProfile,
    uid: string,
    bindingHash: string,
  ): Promise<CallbackResult> {
    const db = this.db;
    const fail = (code: UpstreamError): CallbackResult => ({
      kind: 'error',
      code,
      uid,
      purpose: 'login',
    });
    const ticket = async (principalId: string): Promise<CallbackResult> => {
      const raw = random();
      await db
        .insertInto('login_tickets')
        .values({
          ticket_hash: hashToken(raw),
          principal_id: principalId,
          uid,
          binding_hash: bindingHash,
          expires_at: later(TICKET_TTL_MS),
        })
        .execute();
      return { kind: 'ticket', uid, ticket: raw };
    };

    // 1. A known identity signs in as its account.
    const known = await db
      .selectFrom('linked_accounts')
      .innerJoin('users', 'users.principal_id', 'linked_accounts.principal_id')
      .select(['linked_accounts.principal_id', 'users.status'])
      .where('linked_accounts.provider', '=', providerId)
      .where('linked_accounts.external_subject', '=', profile.subject)
      .executeTakeFirst();
    if (known) {
      if (known.status === 'disabled') return fail('disabled');
      await db
        .updateTable('linked_accounts')
        .set({ last_login_at: sql`now()`, email: profile.email ?? null })
        .where('provider', '=', providerId)
        .where('external_subject', '=', profile.subject)
        .execute();
      return ticket(known.principal_id);
    }

    // 3. The same verified address as an existing account: attach nothing until its owner says so.
    if (profile.email && profile.emailVerified) {
      const owner = await db
        .selectFrom('user_emails')
        .innerJoin('users', 'users.principal_id', 'user_emails.principal_id')
        .select(['user_emails.principal_id', 'users.status'])
        .where(sql`lower(user_emails.email)`, '=', profile.email.toLowerCase())
        .where('user_emails.verified_at', 'is not', null)
        .executeTakeFirst();
      if (owner) {
        if (owner.status === 'disabled') return fail('disabled');
        if (this.options.auth.autolink.includes(providerId)) {
          if (!(await this.attach(db, owner.principal_id, providerId, profile)))
            return fail('owned');
          return ticket(owner.principal_id);
        }
        const hasPassword = await db
          .selectFrom('credentials')
          .select('principal_id')
          .where('principal_id', '=', owner.principal_id)
          .executeTakeFirst();
        if (!hasPassword) return fail('use-existing');
        const id = random();
        await db
          .insertInto('pending_links')
          .values({
            id_hash: hashToken(id),
            provider: providerId,
            external_subject: profile.subject,
            email: profile.email,
            display_name: profile.name ?? null,
            principal_id: owner.principal_id,
            uid,
            binding_hash: bindingHash,
            expires_at: later(PENDING_TTL_MS),
          })
          .execute();
        return { kind: 'pending-link', uid, id };
      }
    }

    // 4. A new person: the sign-up policy decides.
    const created = await this.createUser(providerId, profile);
    if (created.queued) {
      await this.options
        .onApplication?.({
          name: profile.name ?? profile.email ?? 'Someone',
          email: profile.email && profile.emailVerified ? profile.email : undefined,
          note: `Signed up with ${this.providers.get(providerId)?.config.label ?? providerId}`,
        })
        .catch(() => undefined);
    }
    return created.error ? fail(created.error) : ticket(created.principalId);
  }

  /** Adds the identity to the account, unless another account has it. Safe to repeat. */
  async attach(
    db: Kysely<Database>,
    principalId: string,
    providerId: string,
    profile: UpstreamProfile,
  ): Promise<boolean> {
    return db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('linked_accounts')
        .values({
          provider: providerId,
          external_subject: profile.subject,
          principal_id: principalId,
          email: profile.email ?? null,
          display_name: profile.name ?? null,
        })
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst();
      if (!inserted.numInsertedOrUpdatedRows) {
        const existing = await trx
          .selectFrom('linked_accounts')
          .select('principal_id')
          .where('provider', '=', providerId)
          .where('external_subject', '=', profile.subject)
          .executeTakeFirst();
        return existing?.principal_id === principalId;
      }
      if (profile.email && profile.emailVerified) {
        await verifyEmail(trx, principalId, profile.email, { addIfMissing: true });
      }
      return true;
    });
  }

  private async createUser(
    providerId: string,
    profile: UpstreamProfile,
  ): Promise<
    | { principalId: string; queued: boolean; error?: undefined }
    | { error: UpstreamError; principalId?: undefined; queued?: undefined }
  > {
    const { signup, autoApproveDomains, maxPending } = this.options.auth;
    return this.db.transaction().execute(async (trx) => {
      const verifiedEmail = profile.email && profile.emailVerified ? profile.email : undefined;
      // An invitation for the address, which the provider vouches for, is the way in when sign-up is closed.
      const invite = verifiedEmail
        ? await trx
            .updateTable('account_tokens')
            .set({ used_at: sql`now()` })
            .where('purpose', '=', 'invite')
            .where(sql`lower(email)`, '=', verifiedEmail.toLowerCase())
            .where('used_at', 'is', null)
            .where('expires_at', '>', sql<Date>`now()`)
            .returning('is_admin')
            .executeTakeFirst()
        : undefined;
      const domain = verifiedEmail?.split('@').pop()?.toLowerCase();
      const trusted = domain !== undefined && autoApproveDomains.includes(domain);
      let status: 'active' | 'pending';
      if (invite || signup === 'open') status = 'active';
      else if (signup === 'closed') return { error: 'closed' as const };
      else status = trusted ? 'active' : 'pending';
      if (status === 'pending' && (await applicationQueueFull(trx, maxPending)))
        return { error: 'paused' as const };
      const principalId = await insertAccount(trx, this.options.origin, {
        displayName: profile.name ?? verifiedEmail,
        email: verifiedEmail,
        emailVerified: true,
        isAdmin: invite?.is_admin ?? false,
        status,
      });
      await trx
        .insertInto('linked_accounts')
        .values({
          provider: providerId,
          external_subject: profile.subject,
          principal_id: principalId,
          email: profile.email ?? null,
          display_name: profile.name ?? null,
        })
        .execute();
      if (!invite && signup !== 'open') {
        await recordApplication(trx, principalId, {
          note: `Signed up with ${this.providers.get(providerId)?.config.label ?? providerId}`,
          approved: status === 'active',
          decisionNote: 'Verified address in an approved domain',
        });
      }
      return { principalId, queued: status === 'pending' };
    });
  }

  /** Uses up a login ticket, if it is for this interaction and this browser. */
  async redeemTicket(uid: string, ticket: string, binding: string): Promise<string | undefined> {
    const row = await this.db
      .deleteFrom('login_tickets')
      .where('ticket_hash', '=', hashToken(ticket))
      .where('uid', '=', uid)
      .where('binding_hash', '=', hashToken(binding))
      .where('expires_at', '>', sql<Date>`now()`)
      .returning('principal_id')
      .executeTakeFirst();
    return row?.principal_id;
  }

  /** What a pending link would connect, for the page asking the person to sign in. */
  async pendingLink(id: string, uid: string, binding: string) {
    const row = await this.db
      .selectFrom('pending_links')
      .select(['provider', 'email'])
      .where('id_hash', '=', hashToken(id))
      .where('uid', '=', uid)
      .where('binding_hash', '=', hashToken(binding))
      .where('expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      provider: row.provider,
      label: this.providers.get(row.provider)?.config.label ?? row.provider,
      email: row.email,
    };
  }

  /**
   * Having signed in to `principalId` with a password, attaches the identity
   * held in the pending link if it was made for that account in this browser.
   * Either way the link is spent. Returns whether anything was attached.
   */
  async completePendingLink(
    id: string,
    uid: string,
    binding: string,
    principalId: string,
  ): Promise<boolean> {
    const row = await this.db
      .deleteFrom('pending_links')
      .where('id_hash', '=', hashToken(id))
      .where('uid', '=', uid)
      .where('binding_hash', '=', hashToken(binding))
      .where('expires_at', '>', sql<Date>`now()`)
      .returning(['provider', 'external_subject', 'email', 'display_name', 'principal_id'])
      .executeTakeFirst();
    if (!row || row.principal_id !== principalId) return false;
    return this.attach(this.db, principalId, row.provider, {
      subject: row.external_subject,
      email: row.email,
      emailVerified: true,
      name: row.display_name ?? undefined,
    });
  }

  /** Whether the user would still have a way to sign in without this provider. */
  async methodsLeftWithout(principalId: string, providerId: string): Promise<number> {
    const password = await this.db
      .selectFrom('credentials')
      .select('principal_id')
      .where('principal_id', '=', principalId)
      .executeTakeFirst();
    const links = await this.db
      .selectFrom('linked_accounts')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('principal_id', '=', principalId)
      .where('provider', '<>', providerId)
      .executeTakeFirstOrThrow();
    return (password ? 1 : 0) + Number(links.n);
  }

  async unlink(principalId: string, providerId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('linked_accounts')
      .where('principal_id', '=', principalId)
      .where('provider', '=', providerId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async linksOf(
    principalId: string,
  ): Promise<{ provider: string; label: string; email?: string }[]> {
    const rows = await this.db
      .selectFrom('linked_accounts')
      .select(['provider', 'email'])
      .where('principal_id', '=', principalId)
      .orderBy('created_at')
      .execute();
    return rows.map((r) => ({
      provider: r.provider,
      label: this.providers.get(r.provider)?.config.label ?? r.provider,
      ...(r.email ? { email: r.email } : {}),
    }));
  }
}

/** Removes trips, tickets and link requests that have run out. */
export async function purgeUpstream(db: Kysely<Database>): Promise<void> {
  await db
    .deleteFrom('upstream_attempts')
    .where('expires_at', '<', sql<Date>`now()`)
    .execute();
  await db
    .deleteFrom('pending_links')
    .where('expires_at', '<', sql<Date>`now()`)
    .execute();
  await db
    .deleteFrom('login_tickets')
    .where('expires_at', '<', sql<Date>`now()`)
    .execute();
}
