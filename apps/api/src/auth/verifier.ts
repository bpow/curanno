/**
 * Bearer token validation against the identity provider's JWKS (ADR 0005).
 * Discovery runs lazily on the first token and is cached; tests pass a local
 * key set instead. A token is accepted when it is signed by the issuer, is
 * within its validity window, and was issued for this API: either `aud`
 * names the configured audience or `azp` is the configured client, which is
 * how Keycloak marks access tokens obtained by a public client.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { serviceUnavailable, unauthorized } from '../problems.js';

export interface TokenClaims {
  issuer: string;
  subject: string;
  name: string | undefined;
  email: string | undefined;
  groups: string[];
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
  fetch?: typeof globalThis.fetch;
}

export function createTokenVerifier(options: VerifierOptions): TokenVerifier {
  let keys: Promise<JWTVerifyGetKey> | undefined = options.jwks
    ? Promise.resolve(options.jwks)
    : undefined;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  async function discover(): Promise<JWTVerifyGetKey> {
    const url = `${options.issuer}/.well-known/openid-configuration`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`discovery at ${url} answered ${res.status}`);
    const document = (await res.json()) as { jwks_uri?: string; issuer?: string };
    if (!document.jwks_uri) throw new Error(`discovery document at ${url} has no jwks_uri`);
    return createRemoteJWKSet(new URL(document.jwks_uri));
  }

  return async (token) => {
    keys ??= discover().catch((err: unknown) => {
      keys = undefined;
      throw serviceUnavailable(`identity provider discovery failed: ${(err as Error).message}`);
    });
    const getKey = await keys;
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, getKey, { issuer: options.issuer }));
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
    return {
      issuer: options.issuer,
      subject: payload.sub,
      name: stringClaim(payload['name']) ?? stringClaim(payload['preferred_username']),
      email: stringClaim(payload['email']),
      groups: groupsClaim(payload['groups']),
      expiresAt: payload.exp,
    };
  };
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Group names from the claim; Keycloak may prefix them with `/` when configured for full paths. */
function groupsClaim(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.replace(/^\/+/, '').trim();
    if (name) names.add(name);
  }
  return [...names];
}
