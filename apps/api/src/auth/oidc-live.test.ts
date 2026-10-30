/**
 * Live OpenID Connect: discovery, the JWKS and a real token from the compose
 * Keycloak (`deploy/keycloak/realm-dev.json`), obtained through the password
 * grant the development realm allows for alice, then accepted by the API.
 * Runs when OIDC_LIVE_ISSUER names a reachable issuer (CI's sidebar job sets
 * it; locally `podman compose up` and export it); skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/index.js';
import { buildServer } from '../server.js';
import { createTestContext, databaseUrl, type TestContext } from '../test/harness.js';
import { createTokenVerifier } from './verifier.js';

const issuer = process.env['OIDC_LIVE_ISSUER'];
const clientId = process.env['OIDC_CLIENT_ID'] ?? 'annotations-sidebar';

async function passwordGrant(user: string): Promise<string> {
  const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      username: user,
      password: user,
      scope: 'openid',
    }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

describe.skipIf(!databaseUrl || !issuer)('live OpenID Connect', () => {
  let scratch: TestContext;
  beforeAll(async () => {
    scratch = await createTestContext();
  });
  afterAll(() => scratch.close());

  it('discovers the issuer, fetches its keys and accepts a token it issued', async () => {
    const verify = createTokenVerifier({ issuer: issuer as string, clientId, audience: clientId });
    const token = await passwordGrant('alice');
    const claims = await verify(token);
    expect(claims.issuer).toBe(issuer);
    expect(claims.subject).toBeTruthy();
    expect(claims.groups).toEqual(['curators']);
    await expect(verify(token.slice(0, -2) + 'xx')).rejects.toMatchObject({ status: 401 });

    // The server built with real discovery takes the token and creates the user from it.
    const db = createDb(scratch.config.databaseUrl);
    const app = await buildServer({
      config: { ...scratch.config, oidc: { ...scratch.config.oidc, issuer: issuer as string } },
      db,
      verifyToken: createTokenVerifier({ issuer: issuer as string, clientId, audience: clientId }),
    });
    try {
      const me = await app.inject({
        method: 'GET',
        url: '/x/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ displayName: 'Alice Annotator' });
      expect(me.json<{ groups: { name: string }[] }>().groups.map((g) => g.name)).toEqual([
        'curators',
      ]);
      const anonymous = await app.inject({
        method: 'GET',
        url: '/x/me',
        headers: { authorization: 'Bearer not-a-token' },
      });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await app.close();
      await db.destroy();
    }
  });
});
