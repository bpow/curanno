/**
 * Account routes of the embedded issuer, plain Fastify routes under `/idp/`
 * beside the API (ADR 0028): accepting an invitation, resetting a forgotten
 * password, verifying an address, and, for a signed-in user, the account page's
 * password and addresses. What an unauthenticated caller can learn is limited
 * on purpose: asking for a reset answers the same whether or not the address
 * has an account, and every failed use of a link counts against the caller.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { requireUser } from '../plugin.js';
import { decideApplication } from '../../accounts/applications.js';
import type { SignupPolicy } from '../../config.js';
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from '../../problems.js';
import {
  acceptInvite,
  AccountError,
  checkCurrentPassword,
  findByEmail,
  loadLogin,
  setPasswordFor,
  signUp,
  SignupRefused,
} from './accounts.js';
import { revokeSessions } from './adapter.js';
import { addEmail, listEmails, makePrimary, removeEmail, verifyEmail } from './emails.js';
import { accepts, body, EMAIL, requireSameOrigin, text } from './http.js';
import { accountLink, addressInUse } from './invites.js';
import type { Mailer } from './mail.js';
import { tellAdministrators } from './notify.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.js';
import { LIMITS, type Throttle } from './throttle.js';
import type { Upstream } from './upstream/service.js';
import { consumeToken, createToken, peekToken } from './tokens.js';

export interface AccountRouteOptions {
  db: Kysely<Database>;
  throttle: Throttle;
  mailer: Mailer | undefined;
  /** The issuer's origin, which is also where the links in mail point. */
  origin: string;
  signup: SignupPolicy;
  upstream: Upstream;
  autoApproveDomains: string[];
  maxPending: number;
}

const PASSWORD = text(MAX_PASSWORD_LENGTH);
const TOKEN = text(200);
const withEmail = accepts({ email: EMAIL });
const withToken = accepts({ token: TOKEN });

export function registerAccountRoutes(app: FastifyInstance, options: AccountRouteOptions): void {
  const { db, throttle, mailer, origin, signup, autoApproveDomains, maxPending, upstream } =
    options;

  const providersOf = () =>
    [...upstream.providers.values()].map((p) => ({ id: p.config.id, label: p.config.label }));

  const address = (request: FastifyRequest): string => throttle.key('address', request.ip);

  /** Every use of a link that fails costs the caller; a guess at 256 bits is hopeless, but a loop is noise. */
  async function useToken(
    request: FastifyRequest,
    purpose: 'invite' | 'reset' | 'verify',
    token: string,
  ) {
    const key = address(request);
    await throttle.check([LIMITS.tokenPerAddress, key]);
    const used = await consumeToken(db, purpose, token);
    if (!used) {
      await throttle.record('token-failed', [key]);
      throw badRequest('This link has expired or was already used.');
    }
    return used;
  }

  function guard(request: FastifyRequest, reply: { header(k: string, v: string): unknown }): void {
    requireSameOrigin(request, origin);
    reply.header('cache-control', 'no-store');
  }

  app.get('/idp/options', (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return {
      mail: mailer !== undefined,
      signup,
      providers: providersOf(),
    };
  });

  const signupBody = accepts({ email: EMAIL, password: PASSWORD, displayName: text(200) });
  app.post('/idp/signup', signupBody, async (request, reply) => {
    guard(request, reply);
    if (signup === 'closed') throw forbidden('Accounts are created by invitation here.');
    const sent = body<{ email: string; password: string; displayName: string; note?: unknown }>(
      request,
    );
    const email = sent.email.trim();
    const password = sent.password;
    const displayName = sent.displayName.trim();
    const rawNote = sent.note;
    const note = typeof rawNote === 'string' ? rawNote.slice(0, 1000) : undefined;
    const byAddress = address(request);
    const byEmail = throttle.key('email', email);
    await throttle.check([LIMITS.signupPerAddress, byAddress]);
    await throttle.record('signup', [byAddress]);
    const status = signup === 'approval' ? 'pending' : 'active';
    if (await addressInUse(db, email)) {
      // Whether an address has an account is not for a stranger to learn. With mail, the answer is
      // the same and the owner is told; without it, there is no way to hide that the login is taken.
      if (!mailer) throw conflict('That address already has an account.');
      try {
        await throttle.check([LIMITS.signupPerEmail, byEmail]);
        await throttle.record('signup-email', [byEmail]);
        await mailer.send({
          to: email,
          subject: 'Someone used your address to sign up for curanno',
          text: `Someone tried to create an account with this address, which already has one. If it was you, sign in, or choose "Forgot your password" to get back in. If not, ignore this message.\n${origin}\n`,
        });
      } catch {
        // Over the limit or mail down: still the same answer.
      }
      return reply.code(202).send({ status });
    }
    try {
      const created = await signUp(
        db,
        origin,
        { login: email, email, password, displayName, note },
        { approval: signup === 'approval', maxPending },
      );
      await throttle.note('signed-up', created.principalId, status);
      if (mailer) {
        const token = await createToken(db, {
          purpose: 'verify',
          email,
          principalId: created.principalId,
        });
        await mailer
          .send({
            to: email,
            subject: 'Verify your email address for curanno',
            text: `Confirm that this address is yours (the link works once, for two days):\n${accountLink(origin, 'verify', token)}\n`,
          })
          .catch((err: unknown) =>
            request.log.warn({ err }, 'sending the verification mail failed'),
          );
        if (created.applicationId) {
          await tellAdministrators(db, mailer, origin, { name: displayName, email, note }).catch(
            (err: unknown) => request.log.warn({ err }, 'notifying the administrators failed'),
          );
        }
      }
    } catch (err) {
      if (err instanceof SignupRefused) throw serviceUnavailable(err.message);
      if (err instanceof AccountError) throw badRequest(err.message);
      throw err;
    }
    return reply.code(202).send({ status });
  });

  app.post('/idp/invite/peek', withToken, async (request, reply) => {
    guard(request, reply);
    const key = address(request);
    await throttle.check([LIMITS.tokenPerAddress, key]);
    const found = await peekToken(db, 'invite', body<{ token: string }>(request).token);
    if (!found) {
      await throttle.record('token-failed', [key]);
      throw badRequest('This link has expired or was already used.');
    }
    return { email: found.email };
  });

  const inviteBody = accepts({ token: TOKEN, password: PASSWORD, displayName: text(200, 0) });
  app.post('/idp/invite/accept', inviteBody, async (request, reply) => {
    guard(request, reply);
    const { token, password, displayName } = body<{
      token: string;
      password: string;
      displayName: string;
    }>(request);
    const key = address(request);
    await throttle.check([LIMITS.tokenPerAddress, key]);
    let principalId: string | undefined;
    try {
      principalId = await acceptInvite(db, origin, token, { password, displayName });
    } catch (err) {
      if (err instanceof AccountError) throw badRequest(err.message);
      throw err;
    }
    if (!principalId) {
      await throttle.record('token-failed', [key]);
      throw badRequest('This link has expired or was already used.');
    }
    await throttle.note('account-created', principalId, 'invitation');
    return reply.code(201).send({});
  });

  app.post('/idp/reset/request', withEmail, async (request, reply) => {
    guard(request, reply);
    const email = body<{ email: string }>(request).email.trim();
    const byAddress = address(request);
    const byEmail = throttle.key('email', email);
    // The same answer whatever happens, including being over the limit: nothing to learn here.
    const accepted = (): unknown => reply.code(202).send({});
    try {
      await throttle.check([LIMITS.resetPerAddress, byAddress], [LIMITS.resetPerEmail, byEmail]);
    } catch {
      return accepted();
    }
    await throttle.record('reset-requested', [byAddress, byEmail]);
    if (!mailer) return accepted();
    const found = await findByEmail(db, email);
    if (found) {
      const token = await createToken(db, {
        purpose: 'reset',
        email: found.email,
        principalId: found.principalId,
      });
      await mailer
        .send({
          to: found.email,
          subject: 'Reset your curanno password',
          text: `Someone asked to reset the password of this account. If it was you, choose a new one here (the link works once, for an hour):\n${accountLink(origin, 'reset', token)}\n\nIf it was not you, ignore this message; nothing changes.\n`,
        })
        .catch((err: unknown) => request.log.warn({ err }, 'sending the reset mail failed'));
    }
    return accepted();
  });

  const resetBody = accepts({ token: TOKEN, password: PASSWORD });
  app.post('/idp/reset/complete', resetBody, async (request, reply) => {
    guard(request, reply);
    const { token, password } = body<{ token: string; password: string }>(request);
    // Check the password before using the link up, so a too-short one can be retyped.
    try {
      checkLength(password);
    } catch (err) {
      if (err instanceof AccountError) throw badRequest(err.message);
      throw err;
    }
    const used = await useToken(request, 'reset', token);
    if (!used.principalId) throw badRequest('This link has expired or was already used.');
    await setPasswordFor(db, used.principalId, password);
    await revokeSessions(db, used.principalId);
    await throttle.note('password-reset', used.principalId);
    return {};
  });

  app.post('/idp/email/verify', withToken, async (request, reply) => {
    guard(request, reply);
    const used = await useToken(request, 'verify', body<{ token: string }>(request).token);
    const principalId = used.principalId;
    if (
      !principalId ||
      !(await db.transaction().execute((trx) => verifyEmail(trx, principalId, used.email)))
    ) {
      throw conflict('That address could not be verified; it may belong to another account.');
    }
    // An applicant who proves an address in an allowed domain needs no administrator.
    const domain = used.email.split('@').pop()?.toLowerCase() ?? '';
    if (autoApproveDomains.includes(domain)) {
      const pending = await db
        .selectFrom('applications')
        .select('id')
        .where('principal_id', '=', used.principalId)
        .where('decision', 'is', null)
        .executeTakeFirst();
      if (pending) {
        await decideApplication(
          db,
          pending.id,
          'approved',
          null,
          'Verified address in an approved domain',
        );
      }
    }
    return { email: used.email };
  });

  // The account page: the signed-in user's own sign-in name, password and addresses.
  app.get('/idp/account', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const { userId } = requireUser(request);
    const login = await loadLogin(db, userId);
    return {
      login: login ?? null,
      emails: await listEmails(db, userId),
      mail: mailer !== undefined,
      links: await upstream.linksOf(userId),
      providers: providersOf(),
    };
  });

  const passwordBody = accepts({ current: PASSWORD, next: PASSWORD });
  app.post('/idp/password', passwordBody, async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    const { current, next } = body<{ current: string; next: string }>(request);
    const key = throttle.key('user', userId);
    await throttle.check([LIMITS.passwordPerUser, key]);
    if (!(await checkCurrentPassword(db, userId, current))) {
      await throttle.record('password-failed', [key], { principalId: userId });
      throw badRequest('The current password is not right.');
    }
    try {
      await setPasswordFor(db, userId, next);
    } catch (err) {
      if (err instanceof AccountError) throw badRequest(err.message);
      throw err;
    }
    await throttle.note('password-changed', userId);
    return {};
  });

  app.post('/idp/emails', withEmail, async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    if (!mailer)
      throw serviceUnavailable('This server cannot send mail, so it cannot verify addresses.');
    const email = body<{ email: string }>(request).email.trim();
    const key = throttle.key('user', userId);
    await throttle.check([LIMITS.verifyPerUser, key]);
    await throttle.record('verify-requested', [key], { principalId: userId });
    // An address verified by someone else is not disclosed: the mail simply is not sent.
    if (!(await addressInUse(db, email))) {
      await addEmail(db, userId, email);
      const token = await createToken(db, { purpose: 'verify', email, principalId: userId });
      await mailer
        .send({
          to: email,
          subject: 'Verify your email address for curanno',
          text: `Confirm that this address is yours (the link works once, for two days):\n${accountLink(origin, 'verify', token)}\n`,
        })
        .catch((err: unknown) => request.log.warn({ err }, 'sending the verification mail failed'));
    }
    return reply.code(202).send({});
  });

  app.post('/idp/emails/primary', withEmail, async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    const email = body<{ email: string }>(request).email.trim();
    if (!(await db.transaction().execute((trx) => makePrimary(trx, userId, email)))) {
      throw notFound('No such verified address');
    }
    return {};
  });

  app.post('/idp/emails/remove', withEmail, async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    const email = body<{ email: string }>(request).email.trim();
    if (!(await db.transaction().execute((trx) => removeEmail(trx, userId, email)))) {
      throw notFound('No such address, or it is the primary one');
    }
    return {};
  });
}

function checkLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(`The password must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}
