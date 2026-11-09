/**
 * Signing in for the end-to-end tests, in either auth mode. `E2E_AUTH=embedded`
 * selects the embedded issuer (ADR 0028), whose users alice and bob are made
 * by `account create` before the run (see .github/workflows/ci.yml); anything
 * else is the compose Zitadel (dev-token.ts).
 */
import { createHash, randomBytes } from 'node:crypto';
import { devAccessToken } from './dev-token.js';

export const embedded = process.env['E2E_AUTH'] === 'embedded';

export type E2eUser = 'alice' | 'bob';

/** What the user types: Zitadel's development users use their name; embedded ones need ten characters. */
export const passwordFor = (user: E2eUser): string => (embedded ? `${user}-e2e-password` : user);

const NAMES: Record<E2eUser, string> = { alice: 'Alice Annotator', bob: 'Bob Reviewer' };
export const displayNameOf = (user: E2eUser): string => NAMES[user];

/** The issuer's origin: where the browser sees it, which is the site's in development. */
export function issuerOrigin(): string {
  return (
    process.env['PUBLIC_URL'] ?? `http://localhost:${process.env['WEB_PORT'] || 3001}`
  ).replace(/\/$/, '');
}

export function accessToken(user: E2eUser): Promise<string> {
  return embedded ? embeddedAccessToken(user) : devAccessToken(user);
}

/** The authorization code flow with PKCE over HTTP, the way a browser would run it, without one. */
async function embeddedAccessToken(user: E2eUser): Promise<string> {
  const origin = issuerOrigin();
  const redirectUri = `${origin}/sidebar/popup-callback.html`;
  const verifier = randomBytes(32).toString('base64url');
  const jar = new Map<string, string>();
  const get = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(url.startsWith('http') ? url : origin + url, {
      redirect: 'manual',
      ...init,
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return res;
  };
  const authorize = new URLSearchParams({
    client_id: 'curanno',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'e2e',
  });
  const interaction = (await get(`/oidc/auth?${authorize.toString()}`)).headers.get('location');
  if (!interaction?.startsWith('/oidc/interaction/')) throw new Error(`authorize: ${interaction}`);
  const login = await get(`${interaction}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: user, password: passwordFor(user) }),
  });
  if (!login.ok) throw new Error(`login: ${login.status} ${await login.text()}`);
  const { redirectTo } = (await login.json()) as { redirectTo: string };
  const resumed = await get(redirectTo);
  const code = new URL(resumed.headers.get('location') ?? '', origin).searchParams.get('code');
  if (!code) throw new Error(`no code: ${resumed.status} ${resumed.headers.get('location')}`);
  const token = await fetch(`${origin}/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'curanno',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!token.ok) throw new Error(`token: ${token.status} ${await token.text()}`);
  return ((await token.json()) as { access_token: string }).access_token;
}
