/**
 * Account routes of the embedded issuer, plain Fastify routes under `/auth/`
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
import { badRequest, conflict, notFound, serviceUnavailable } from '../../problems.js';
import {
  acceptInvite,
  AccountError,
  addEmail,
  checkCurrentPassword,
  findByEmail,
  listEmails,
  loadLogin,
  makePrimary,
  removeEmail,
  setPasswordFor,
  verifyEmail,
} from './accounts.js';
import { revokeSessions } from './adapter.js';
import { emailField, field, requireSameOrigin } from './http.js';
import { accountLink, addressInUse } from './invites.js';
import type { Mailer } from './mail.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.js';
import { LIMITS, type Throttle } from './throttle.js';
import { consumeToken, createToken, peekToken } from './tokens.js';

export interface AccountRouteOptions {
  db: Kysely<Database>;
  throttle: Throttle;
  mailer: Mailer | undefined;
  /** The issuer's origin, which is also where the links in mail point. */
  origin: string;
}

export function registerAccountRoutes(app: FastifyInstance, options: AccountRouteOptions): void {
  const { db, throttle, mailer, origin } = options;

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

  app.get('/auth/options', (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { mail: mailer !== undefined };
  });

  app.post('/auth/invite/peek', async (request, reply) => {
    guard(request, reply);
    const key = address(request);
    await throttle.check([LIMITS.tokenPerAddress, key]);
    const found = await peekToken(db, 'invite', field(request.body, 'token', 200));
    if (!found) {
      await throttle.record('token-failed', [key]);
      throw badRequest('This link has expired or was already used.');
    }
    return { email: found.email };
  });

  app.post('/auth/invite/accept', async (request, reply) => {
    guard(request, reply);
    const token = field(request.body, 'token', 200);
    const password = field(request.body, 'password', MAX_PASSWORD_LENGTH);
    const displayName = field(request.body, 'displayName', 200, 0);
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

  app.post('/auth/reset/request', async (request, reply) => {
    guard(request, reply);
    const email = emailField(request.body);
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

  app.post('/auth/reset/complete', async (request, reply) => {
    guard(request, reply);
    const token = field(request.body, 'token', 200);
    const password = field(request.body, 'password', MAX_PASSWORD_LENGTH);
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

  app.post('/auth/email/verify', async (request, reply) => {
    guard(request, reply);
    const used = await useToken(request, 'verify', field(request.body, 'token', 200));
    if (!used.principalId || !(await verifyEmail(db, used.principalId, used.email))) {
      throw conflict('That address could not be verified; it may belong to another account.');
    }
    return { email: used.email };
  });

  // The account page: the signed-in user's own sign-in name, password and addresses.
  app.get('/auth/account', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const { userId } = requireUser(request);
    const login = await loadLogin(db, userId);
    return {
      login: login ?? null,
      emails: await listEmails(db, userId),
      mail: mailer !== undefined,
    };
  });

  app.post('/auth/password', async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    const current = field(request.body, 'current', MAX_PASSWORD_LENGTH);
    const next = field(request.body, 'next', MAX_PASSWORD_LENGTH);
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

  app.post('/auth/emails', async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    if (!mailer)
      throw serviceUnavailable('This server cannot send mail, so it cannot verify addresses.');
    const email = emailField(request.body);
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

  app.post('/auth/emails/primary', async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    if (!(await makePrimary(db, userId, emailField(request.body)))) {
      throw notFound('No such verified address');
    }
    return {};
  });

  app.post('/auth/emails/remove', async (request, reply) => {
    guard(request, reply);
    const { userId } = requireUser(request);
    if (!(await removeEmail(db, userId, emailField(request.body)))) {
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
