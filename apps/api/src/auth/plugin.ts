/**
 * Authentication for every request: a bearer token, when present, must be
 * valid and resolves to a user; without one the request is anonymous. The
 * `bearerAuth` security handler that fastify-openapi-glue runs for
 * operations whose security requires it then only has to check that the
 * caller is a user. Operations that also allow `{}` pass anonymous callers
 * through to their handler, which filters by the public principal.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/index.js';
import { accountWithheld, forbidden, unauthorized } from '../problems.js';
import {
  ANONYMOUS,
  resolveCaller,
  withhold,
  type Caller,
  type ResolveOptions,
  type UserCaller,
} from './caller.js';
import type { TokenVerifier } from './verifier.js';

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller;
  }
}

export interface AuthOptions extends ResolveOptions {
  db: Kysely<Database>;
  verifyToken: TokenVerifier;
  /** Longest time a resolved token is reused without touching the database. */
  cacheMs?: number;
}

/** Live tokens kept at most; beyond it the oldest are re-verified on their next request. */
const MAX_CACHED = 10_000;

/** How long a user who may not act yet is remembered, at most. */
const WITHHELD_CACHE_MS = 3000;

export function installAuth(app: FastifyInstance, options: AuthOptions): void {
  const cacheMs = options.cacheMs ?? 60_000;
  const cache = new Map<string, { caller: Caller; expiresAt: number }>();

  app.decorateRequest('caller');
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (header === undefined) {
      request.caller = ANONYMOUS;
      return;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw unauthorized('Authorization header must be "Bearer <token>"');
    const token = match[1] as string;
    const now = Date.now();
    const cached = cache.get(token);
    if (cached && cached.expiresAt > now) {
      request.caller = cached.caller;
      return;
    }
    const claims = await options.verifyToken(token);
    const user = await resolveCaller(options.db, claims, options);
    const caller: Caller = user.status === 'active' ? user : withhold(user);
    const tokenExpiry = claims.expiresAt === undefined ? Infinity : claims.expiresAt * 1000;
    // Someone waiting to be let in is re-checked soon, so approval is noticed within seconds.
    const keepMs = caller.kind === 'user' ? cacheMs : Math.min(cacheMs, WITHHELD_CACHE_MS);
    cache.set(token, { caller, expiresAt: Math.min(now + keepMs, tokenExpiry) });
    if (cache.size > MAX_CACHED) {
      for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
      // Still too many live entries: drop the oldest, which a Map keeps first.
      for (const key of cache.keys()) {
        if (cache.size <= MAX_CACHED) break;
        cache.delete(key);
      }
    }
    request.caller = caller;
  });
}

/** Security handlers keyed by the OpenAPI document's security scheme names. */
export const securityHandlers = {
  bearerAuth(request: FastifyRequest): void {
    const caller = request.caller;
    if (caller.kind === 'user') return;
    if (caller.withheld) {
      // A user who may not act yet can still ask who they are, to be told why.
      if (request.method === 'GET' && request.routeOptions.url === '/x/me') return;
      throw accountWithheld(caller.withheld.status);
    }
    throw unauthorized('a bearer token is required');
  },
};

export function requireUser(request: FastifyRequest): UserCaller {
  const caller = request.caller;
  if (caller.kind !== 'user') {
    if (caller.withheld) throw accountWithheld(caller.withheld.status);
    throw unauthorized('a bearer token is required');
  }
  return caller;
}

export function requireAdmin(request: FastifyRequest): UserCaller {
  const caller = requireUser(request);
  if (!caller.isAdmin) throw forbidden('administrators only');
  return caller;
}
