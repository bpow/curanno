/**
 * The browser-facing routes of signing in through upstream providers and of
 * linking them to an account (ADR 0028). The sign-in page sends the browser
 * to `/oidc/interaction/:uid/upstream/:provider`, which is under the
 * interaction's own cookie path; the provider returns it to a fixed callback
 * address, which cannot see that cookie, so the result comes back through a
 * one-use ticket at `/oidc/interaction/:uid/finish`, again under the path.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type Provider from 'oidc-provider';
import type { Database } from '../../../db/schema.js';
import { requireUser } from '../../plugin.js';
import { badRequest, conflict, notFound, Problem } from '../../../problems.js';
import { checkCurrentPassword } from '../accounts.js';
import { readCookie, setCookie } from '../cookies.js';
import { accepts, body, requireSameOrigin, text } from '../http.js';
import { interactionFor } from '../interaction.js';
import { MAX_PASSWORD_LENGTH } from '../password.js';
import { LIMITS, type Throttle } from '../throttle.js';
import type { Upstream } from './service.js';

/** How recent a sign-in must be to change how the account can be signed in to, when it has no password to ask for. */
const FRESH_MS = 10 * 60_000;

export interface UpstreamRouteOptions {
  provider: Provider;
  db: Kysely<Database>;
  upstream: Upstream;
  throttle: Throttle;
  origin: string;
  bindingCookie: string;
}

export function registerUpstreamRoutes(app: FastifyInstance, options: UpstreamRouteOptions): void {
  const { provider, db, upstream, throttle, origin, bindingCookie } = options;
  const secure = origin.startsWith('https://');

  const loginPage = (query: Record<string, string | undefined>): string =>
    `/account/login?${new URLSearchParams(
      Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined),
    ).toString()}`;

  function chosen(request: FastifyRequest): string {
    const { providerId } = request.params as { providerId: string };
    if (!upstream.providers.has(providerId)) throw notFound('No such sign-in provider');
    return providerId;
  }

  app.get('/oidc/interaction/:uid/upstream/:providerId', async (request, reply) => {
    const providerId = chosen(request);
    const found = await interactionFor(provider, request, reply);
    const binding = randomBytes(32).toString('base64url');
    const url = await upstream.start(providerId, { purpose: 'login', uid: found.uid }, binding);
    setCookie(reply, bindingCookie, binding, { secure, maxAgeSeconds: 600 });
    reply.header('cache-control', 'no-store');
    return reply.redirect(url);
  });

  app.get('/idp/upstream/:providerId/callback', async (request, reply) => {
    const providerId = chosen(request);
    const callback = new URL(request.raw.url ?? '', origin);
    const result = await upstream.callback(
      providerId,
      callback,
      readCookie(request, bindingCookie),
    );
    reply.header('cache-control', 'no-store');
    switch (result.kind) {
      case 'ticket':
        return reply.redirect(
          `/oidc/interaction/${encodeURIComponent(result.uid)}/finish?ticket=${encodeURIComponent(result.ticket)}`,
        );
      case 'pending-link':
        return reply.redirect(loginPage({ uid: result.uid, link: result.id }));
      case 'connected':
        return reply.redirect('/me?linked=1');
      case 'error':
        return reply.redirect(
          result.purpose === 'connect'
            ? `/me?link_error=${result.code}`
            : loginPage({ uid: result.uid, error: result.code }),
        );
    }
  });

  app.get('/oidc/interaction/:uid/finish', async (request, reply) => {
    const { uid } = request.params as { uid: string };
    const ticket = (request.query as { ticket?: string }).ticket;
    const binding = readCookie(request, bindingCookie);
    reply.header('cache-control', 'no-store');
    const principalId =
      ticket && binding ? await upstream.redeemTicket(uid, ticket, binding) : undefined;
    if (!principalId) return reply.redirect(loginPage({ uid, error: 'expired' }));
    await interactionFor(provider, request, reply);
    await throttle.note('login', principalId, 'upstream');
    const redirectTo = await provider.interactionResult(
      request.raw,
      reply.raw,
      { login: { accountId: principalId, remember: true } },
      { mergeWithLastSubmission: false },
    );
    return reply.redirect(redirectTo);
  });

  app.get('/idp/upstream/pending/:id', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const { id } = request.params as { id: string };
    const uid = (request.query as { uid?: string }).uid;
    const binding = readCookie(request, bindingCookie);
    const found = uid && binding ? await upstream.pendingLink(id, uid, binding) : undefined;
    if (!found) throw notFound('This link request has expired or was made in another browser.');
    return found;
  });

  /** Proof that it is still the account's owner at the keyboard before its sign-in methods change. */
  async function reauthenticate(
    request: FastifyRequest,
    userId: string,
    issuedAt: number | undefined,
  ): Promise<void> {
    const key = throttle.key('user', userId);
    await throttle.check([LIMITS.passwordPerUser, key]);
    const hasPassword = await db
      .selectFrom('credentials')
      .select('principal_id')
      .where('principal_id', '=', userId)
      .executeTakeFirst();
    if (hasPassword) {
      const { password } = body<{ password?: string }>(request);
      if (password === undefined) throw badRequest('password is required');
      if (!(await checkCurrentPassword(db, userId, password))) {
        await throttle.record('password-failed', [key], { principalId: userId });
        throw badRequest('The password is not right.');
      }
      return;
    }
    if (issuedAt === undefined || Date.now() - issuedAt > FRESH_MS) {
      throw new Problem(
        403,
        'Forbidden',
        'Sign in again, then retry: this needs a recent sign-in.',
      );
    }
  }

  // Asked for only when the account has a password (`reauthenticate`), so not required here.
  const withPassword = accepts({ password: text(MAX_PASSWORD_LENGTH) }, []);

  app.post('/idp/links/:providerId/start', withPassword, async (request, reply) => {
    requireSameOrigin(request, origin);
    reply.header('cache-control', 'no-store');
    const providerId = chosen(request);
    const caller = requireUser(request);
    await reauthenticate(request, caller.userId, caller.issuedAt);
    const binding = randomBytes(32).toString('base64url');
    const url = await upstream.start(
      providerId,
      { purpose: 'connect', principalId: caller.userId },
      binding,
    );
    setCookie(reply, bindingCookie, binding, { secure, maxAgeSeconds: 600 });
    return { url };
  });

  app.post('/idp/links/:providerId/unlink', withPassword, async (request, reply) => {
    requireSameOrigin(request, origin);
    reply.header('cache-control', 'no-store');
    const { providerId } = request.params as { providerId: string };
    const caller = requireUser(request);
    await reauthenticate(request, caller.userId, caller.issuedAt);
    if ((await upstream.methodsLeftWithout(caller.userId, providerId)) < 1) {
      throw conflict('That is the last way to sign in to this account; add another first.');
    }
    if (!(await upstream.unlink(caller.userId, providerId)))
      throw notFound('That account is not linked.');
    await throttle.note('unlinked', caller.userId, providerId);
    return {};
  });
}
