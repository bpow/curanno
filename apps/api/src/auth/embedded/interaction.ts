/**
 * The sign-in step of the authorization flow (ADR 0028). The provider sends
 * the browser to `/oidc/interaction/:uid`; that hands it to the site's login
 * page, which posts the credentials back under the same path, because the
 * interaction cookie is scoped to it. The answer is the address at which the
 * provider resumes the flow, for the page to navigate to.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import type Provider from 'oidc-provider';
import type { Database } from '../../db/schema.js';
import { badRequest, Problem } from '../../problems.js';
import { verifyLogin } from './accounts.js';
import { requireSameOrigin } from './http.js';
import { MAX_PASSWORD_LENGTH } from './password.js';
import { LIMITS, type Throttle } from './throttle.js';

export const LOGIN_PAGE = '/account/login';
const MAX_LOGIN_LENGTH = 320;

export interface InteractionOptions {
  provider: Provider;
  db: Kysely<Database>;
  throttle: Throttle;
  /** The issuer's origin; a browser posting from anywhere else is refused. */
  origin: string;
}

export function registerInteractionRoutes(app: FastifyInstance, options: InteractionOptions): void {
  const { provider, db, origin, throttle } = options;

  async function details(request: FastifyRequest, reply: FastifyReply) {
    const { uid } = request.params as { uid: string };
    try {
      const found = await provider.interactionDetails(request.raw, reply.raw);
      if (found.uid === uid) return found;
    } catch {
      // Falls through: no such interaction, or its cookie is missing or has expired.
    }
    throw badRequest('This sign-in has expired or was not started in this browser. Start again.');
  }

  const sameOrigin = (request: FastifyRequest): void => requireSameOrigin(request, origin);

  app.get('/oidc/interaction/:uid', async (request, reply) => {
    const found = await details(request, reply);
    if (found.prompt.name !== 'login')
      throw badRequest('This sign-in needs a step that is not supported');
    reply.header('cache-control', 'no-store');
    return reply.redirect(`${LOGIN_PAGE}?uid=${encodeURIComponent(found.uid)}`);
  });

  app.post('/oidc/interaction/:uid/login', async (request, reply) => {
    sameOrigin(request);
    const body = request.body as { login?: unknown; password?: unknown } | null;
    if (
      typeof body?.login !== 'string' ||
      typeof body.password !== 'string' ||
      body.login.length === 0 ||
      body.login.length > MAX_LOGIN_LENGTH ||
      body.password.length === 0 ||
      body.password.length > MAX_PASSWORD_LENGTH
    ) {
      throw badRequest('A login and a password are required');
    }
    const found = await details(request, reply);
    if (found.prompt.name !== 'login') throw badRequest('This sign-in is not waiting for a login');
    const byLogin = throttle.key('login', body.login);
    const byAddress = throttle.key('address', request.ip);
    await throttle.check([LIMITS.loginPerLogin, byLogin], [LIMITS.loginPerAddress, byAddress]);
    const accountId = await verifyLogin(db, body.login, body.password);
    if (!accountId) {
      await throttle.record('login-failed', [byLogin, byAddress]);
      throw new Problem(401, 'Unauthorized', 'The login or the password is not right');
    }
    await throttle.note('login', accountId);
    const redirectTo = await provider.interactionResult(
      request.raw,
      reply.raw,
      { login: { accountId, remember: true } },
      { mergeWithLastSubmission: false },
    );
    reply.header('cache-control', 'no-store');
    return { redirectTo };
  });

  app.post('/oidc/interaction/:uid/abort', async (request, reply) => {
    sameOrigin(request);
    await details(request, reply);
    const redirectTo = await provider.interactionResult(
      request.raw,
      reply.raw,
      { error: 'access_denied', error_description: 'The user cancelled the sign-in' },
      { mergeWithLastSubmission: false },
    );
    reply.header('cache-control', 'no-store');
    return { redirectTo };
  });
}
