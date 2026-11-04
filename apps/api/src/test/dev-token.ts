/**
 * An access token for a development user of the compose Zitadel, without a
 * browser. Zitadel has no password grant, so this drives the authorization
 * code flow the way its login UI does: start an authorization request, check
 * the user's password into a session with the login client's token
 * (`deploy/zitadel/.bootstrap/login-client.pat`, or ZITADEL_LOGIN_CLIENT_PAT),
 * finalize the request with the session and redeem the code. The users and
 * the client are made by `deploy/zitadel/provision.ts --dev-users`, and every
 * development user's password is their username. The issuer and the client
 * default to OIDC_ISSUER and OIDC_CLIENT_ID from the environment, then from
 * the repository .env that provision.ts writes.
 *
 * Imported by the live OIDC test and by the management site's end-to-end test.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Registered for the client by provision.ts; the browser never visits it here.
const REDIRECT_URI = 'http://localhost:5173/sidebar/';

const repo = (path: string): URL => new URL(`../../../../${path}`, import.meta.url);

function repositoryEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(repo('.env'), 'utf8'));
  } catch {
    return {};
  }
}

function loginClientToken(): string {
  return (
    process.env['ZITADEL_LOGIN_CLIENT_PAT'] ??
    readFileSync(repo('deploy/zitadel/.bootstrap/login-client.pat'), 'utf8')
  ).trim();
}

async function call(issuer: string, method: string, body: object): Promise<unknown> {
  const res = await fetch(`${issuer}/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${loginClientToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function devAccessToken(
  username: string,
  oidc: { issuer?: string | undefined; clientId?: string | undefined } = {},
): Promise<string> {
  const env = { ...repositoryEnv(), ...process.env };
  const issuer = oidc.issuer ?? env['OIDC_ISSUER'] ?? 'http://localhost:8080';
  const clientId = oidc.clientId ?? env['OIDC_CLIENT_ID'];
  if (!clientId) throw new Error('OIDC_CLIENT_ID is not set: run deploy/zitadel/provision.ts');
  const verifier = randomBytes(32).toString('base64url');
  const authorize = new URL(`${issuer}/oauth/v2/authorize`);
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  const started = await fetch(authorize, { redirect: 'manual' });
  const location = started.headers.get('location');
  const authRequestId = location && new URL(location).searchParams.get('authRequest');
  if (!authRequestId) throw new Error(`authorize: ${started.status} ${location ?? ''}`);

  const session = (await call(issuer, 'zitadel.session.v2.SessionService/CreateSession', {
    checks: { user: { loginName: username }, password: { password: username } },
  })) as { sessionId: string; sessionToken: string };
  const { callbackUrl } = (await call(issuer, 'zitadel.oidc.v2.OIDCService/CreateCallback', {
    authRequestId,
    session,
  })) as { callbackUrl: string };
  const code = new URL(callbackUrl).searchParams.get('code');
  if (!code) throw new Error(`callback without a code: ${callbackUrl}`);

  const res = await fetch(`${issuer}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}
