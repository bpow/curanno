/**
 * Completing a token's profile claims from userinfo, for providers that keep
 * them out of access tokens (Zitadel by default).
 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTokenVerifier } from './verifier.js';

const ISSUER = 'https://idp.test';
const CLIENT_ID = 'curanno-sidebar';
const USERINFO = 'https://idp.test/oidc/v1/userinfo';

let sign: (claims: JWTPayload) => Promise<string>;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  sign = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
});

function userinfoStub(answer: () => Response | Promise<Response>) {
  const calls: { url: string; authorization: string | null }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return answer();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function verifierWith(fetch: typeof globalThis.fetch) {
  return createTokenVerifier({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    audience: CLIENT_ID,
    jwks,
    userinfoEndpoint: USERINFO,
    fetch,
  });
}

describe('profile claims from userinfo', () => {
  it('is not asked when the token carries a name and an email', async () => {
    const stub = userinfoStub(() => Response.json({}));
    const token = await sign({ sub: 'u1', azp: CLIENT_ID, name: 'Ada', email: 'ada@x.test' });
    const claims = await verifierWith(stub.fetch)(token);
    expect(claims).toMatchObject({ name: 'Ada', email: 'ada@x.test' });
    expect(stub.calls).toEqual([]);
  });

  it('fills what the token lacks, asking with the token itself', async () => {
    const stub = userinfoStub(() =>
      Response.json({ sub: 'u1', preferred_username: 'bpow', email: 'bpow@x.test' }),
    );
    const token = await sign({ sub: 'u1', azp: CLIENT_ID });
    const claims = await verifierWith(stub.fetch)(token);
    expect(claims).toMatchObject({ subject: 'u1', name: 'bpow', email: 'bpow@x.test' });
    expect(stub.calls).toEqual([{ url: USERINFO, authorization: `Bearer ${token}` }]);
  });

  it("keeps the token's own claims over userinfo's", async () => {
    const stub = userinfoStub(() =>
      Response.json({ sub: 'u1', name: 'Other', email: 'ada@x.test' }),
    );
    const token = await sign({ sub: 'u1', azp: CLIENT_ID, name: 'Ada' });
    expect(await verifierWith(stub.fetch)(token)).toMatchObject({
      name: 'Ada',
      email: 'ada@x.test',
    });
  });

  it('ignores claims for another subject, and accepts the token when userinfo fails', async () => {
    const token = await sign({ sub: 'u1', azp: CLIENT_ID });
    for (const answer of [
      () => Response.json({ sub: 'someone-else', name: 'Mallory' }),
      () => new Response('nope', { status: 500 }),
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      () => Promise.reject(new Error('connection refused')),
    ]) {
      const claims = await verifierWith(userinfoStub(answer).fetch)(token);
      expect(claims).toMatchObject({ subject: 'u1', name: undefined, email: undefined });
    }
  });
});
