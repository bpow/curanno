/**
 * Bearer token validation against the identity provider's JWKS (ADR 0005).
 * Discovery runs lazily on the first token and is cached; tests pass a local
 * key set instead. A token is accepted when it is signed by the issuer, is
 * within its validity window, and was issued for this API: either `aud`
 * names the configured audience or `azp` is the configured client, which is
 * how Keycloak marks access tokens obtained by a public client.
 *
 * A token without a name or email is completed from the issuer's userinfo
 * endpoint: some providers (Zitadel by default) keep profile claims out of
 * access tokens. Userinfo failing leaves the token's claims as they are.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { serviceUnavailable, unauthorized } from '../problems.js';

export interface TokenClaims {
  issuer: string;
  subject: string;
  name: string | undefined;
  email: string | undefined;
  /** Seconds since the epoch, when present. */
  expiresAt: number | undefined;
}

export type TokenVerifier = (token: string) => Promise<TokenClaims>;

export interface VerifierOptions {
  issuer: string;
  clientId: string;
  audience: string;
  /** Key resolver to use instead of discovering the issuer's JWKS. */
  jwks?: JWTVerifyGetKey;
  /** The userinfo endpoint discovery would find; used with `jwks`. */
  userinfoEndpoint?: string;
  fetch?: typeof globalThis.fetch;
}

interface Provider {
  getKey: JWTVerifyGetKey;
  userinfoEndpoint: string | undefined;
}

const USERINFO_TIMEOUT_MS = 5_000;

export function createTokenVerifier(options: VerifierOptions): TokenVerifier {
  let provider: Promise<Provider> | undefined = options.jwks
    ? Promise.resolve({ getKey: options.jwks, userinfoEndpoint: options.userinfoEndpoint })
    : undefined;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  async function discover(): Promise<Provider> {
    const url = `${options.issuer}/.well-known/openid-configuration`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`discovery at ${url} answered ${res.status}`);
    const document = (await res.json()) as {
      jwks_uri?: string;
      issuer?: string;
      userinfo_endpoint?: string;
    };
    if (!document.jwks_uri) throw new Error(`discovery document at ${url} has no jwks_uri`);
    return {
      getKey: createRemoteJWKSet(new URL(document.jwks_uri)),
      userinfoEndpoint: document.userinfo_endpoint,
    };
  }

  async function userinfo(url: string, token: string, subject: string): Promise<JWTPayload> {
    try {
      const res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
      });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return {};
      const body = (await res.json()) as JWTPayload;
      // OIDC Core 5.3.2: claims for another subject must not be used.
      return body.sub === subject ? body : {};
    } catch {
      return {};
    }
  }

  return async (token) => {
    provider ??= discover().catch((err: unknown) => {
      provider = undefined;
      throw serviceUnavailable(`identity provider discovery failed: ${(err as Error).message}`);
    });
    const { getKey, userinfoEndpoint } = await provider;
    let payload: JWTPayload;
    try {
      // A little tolerance for clock skew between the provider and this server.
      ({ payload } = await jwtVerify(token, getKey, {
        issuer: options.issuer,
        clockTolerance: 30,
      }));
    } catch (err) {
      if (err instanceof errors.JOSEError) throw unauthorized(`invalid bearer token: ${err.code}`);
      throw err;
    }
    const aud =
      payload.aud === undefined ? [] : Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(options.audience) && payload['azp'] !== options.clientId) {
      throw unauthorized('bearer token was not issued for this API');
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw unauthorized('bearer token has no subject');
    }
    let name = nameClaim(payload);
    let email = stringClaim(payload['email']);
    if ((name === undefined || email === undefined) && userinfoEndpoint) {
      const info = await userinfo(userinfoEndpoint, token, payload.sub);
      name ??= nameClaim(info);
      email ??= stringClaim(info['email']);
    }
    return { issuer: options.issuer, subject: payload.sub, name, email, expiresAt: payload.exp };
  };
}

function nameClaim(claims: JWTPayload): string | undefined {
  return stringClaim(claims['name']) ?? stringClaim(claims['preferred_username']);
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
