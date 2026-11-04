/**
 * Live OpenID Connect: discovery, the JWKS and a real token for alice from
 * the compose Zitadel (provisioned by `deploy/zitadel/provision.ts
 * --dev-users`), accepted by the API. Runs when OIDC_LIVE_ISSUER names a
 * reachable issuer and OIDC_CLIENT_ID the provisioned client (CI's
 * sidebar job sets both; locally export them after `podman compose up`);
 * skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/index.js';
import { buildServer } from '../server.js';
import { devAccessToken } from '../test/dev-token.js';
import { createTestContext, databaseUrl, type TestContext } from '../test/harness.js';
import { createTokenVerifier } from './verifier.js';

const issuer = process.env['OIDC_LIVE_ISSUER'];
const clientId = process.env['OIDC_CLIENT_ID'];

describe.skipIf(!databaseUrl || !issuer || !clientId)('live OpenID Connect', () => {
  const oidc = {
    issuer: issuer as string,
    clientId: clientId as string,
    audience: clientId as string,
  };
  let scratch: TestContext;
  beforeAll(async () => {
    scratch = await createTestContext();
  });
  afterAll(() => scratch.close());

  it('discovers the issuer, fetches its keys and accepts a token it issued', async () => {
    const verify = createTokenVerifier(oidc);
    const token = await devAccessToken('alice', oidc);
    const claims = await verify(token);
    expect(claims.issuer).toBe(issuer);
    expect(claims.subject).toBeTruthy();
    await expect(verify(token.slice(0, -2) + 'xx')).rejects.toMatchObject({ status: 401 });

    // The server built with real discovery takes the token and creates the user from it.
    const db = createDb(scratch.config.databaseUrl);
    const app = await buildServer({
      config: { ...scratch.config, oidc: { ...scratch.config.oidc, issuer: issuer as string } },
      db,
      verifyToken: createTokenVerifier(oidc),
    });
    try {
      const me = await app.inject({
        method: 'GET',
        url: '/x/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ displayName: 'Alice Annotator' });
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
