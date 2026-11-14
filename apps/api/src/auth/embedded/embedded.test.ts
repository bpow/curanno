/**
 * The embedded issuer (ADR 0028), driven the way a browser drives it: over
 * HTTP, with a cookie jar, through authorize, the sign-in interaction, the
 * code exchange with PKCE, refresh, and the API accepting the token.
 */
import { createCipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import {
  SignJWT,
  createLocalJWKSet,
  decodeJwt,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_CLIENT_ID, type Config } from '../../config.js';
import { buildServer } from '../../server.js';
import { createTestContext, databaseUrl, type TestContext } from '../../test/harness.js';
import { AccountError, createPasswordUser, setPassword, verifyLogin } from './accounts.js';
import { loadSigningKeys, retireOldKeys, rotateSigningKey } from './keys.js';
import { checkPassword, hashPassword } from './password.js';
import { createEmbeddedIssuer, type EmbeddedIssuer } from './provider.js';
import { seal, unseal } from './secrets.js';
import { LIMITS } from './throttle.js';

const SECRET = 'a-test-secret-of-at-least-32-characters';
const PASSWORD = 'correct horse battery staple';

describe('secrets and passwords', () => {
  it('seals a value so that only the same secret opens it', async () => {
    const sealed = await seal(SECRET, 'private key material');
    expect(sealed).not.toContain('private');
    expect(await unseal(SECRET, sealed)).toBe('private key material');
    await expect(unseal(`${SECRET}x`, sealed)).rejects.toThrow();
    await expect(unseal(SECRET, sealed.slice(0, -2) + 'AA')).rejects.toThrow();
  });

  it('still opens a value sealed in the earlier format, and only with its whole tag', async () => {
    const key = Buffer.from(hkdfSync('sha256', SECRET, 'curanno', 'signing-keys', 32));
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update('private key material', 'utf8'), cipher.final()]);
    const v1 = (tag: Buffer): string =>
      ['v1', ...[iv, tag, body].map((part) => part.toString('base64url'))].join('.');
    const tag = cipher.getAuthTag();
    expect(await unseal(SECRET, v1(tag))).toBe('private key material');
    await expect(unseal(SECRET, v1(tag.subarray(0, 4)))).rejects.toThrow();
    await expect(unseal(`${SECRET}x`, v1(tag))).rejects.toThrow();
  });

  it('hashes passwords with argon2id, and answers false for a login that does not exist', async () => {
    const hashed = await hashPassword(PASSWORD);
    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(await checkPassword(hashed, PASSWORD)).toBe(true);
    expect(await checkPassword(hashed, 'wrong')).toBe(false);
    expect(await checkPassword(undefined, PASSWORD)).toBe(false);
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** What a browser keeps between the requests of one sign-in. */
class Browser {
  private readonly jar = new Map<string, string>();
  constructor(private readonly base: string) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(path.startsWith('http') ? path : this.base + path, {
      redirect: 'manual',
      ...init,
      headers: {
        ...(this.jar.size ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const eq = (pair ?? '').indexOf('=');
      if (eq > 0) this.jar.set((pair ?? '').slice(0, eq), (pair ?? '').slice(eq + 1));
    }
    return res;
  }

  postJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }
}

const b64u = (b: Buffer): string => b.toString('base64url');
const query = (params: Record<string, string>): string => new URLSearchParams(params).toString();

const EXTENSION_ID = 'dmlkjhnoiinndnkboiknehimngilddpp';

describe.skipIf(!databaseUrl)('embedded issuer', () => {
  let ctx: TestContext;
  let issuer: EmbeddedIssuer;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let base = '';
  let config: Config;
  let aliceId = '';
  const redirectUri = (): string => `${base}/sidebar/popup-callback.html`;

  beforeAll(async () => {
    ctx = await createTestContext();
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    config = {
      ...ctx.config,
      port,
      publicUrl: base,
      auth: {
        mode: 'embedded',
        secret: SECRET,
        extraOrigins: [],
        extensionIds: [EXTENSION_ID],
        smtpUrl: undefined,
        mailFrom: undefined,
        signup: 'approval',
        autoApproveDomains: [],
        maxPending: 200,
        providers: [],
        autolink: [],
        bootstrapAdminEmail: undefined,
      },
      oidc: { issuer: base, clientId: EMBEDDED_CLIENT_ID, audience: base },
    };
    issuer = await createEmbeddedIssuer({ config, db: ctx.db });
    app = await buildServer({
      config,
      db: ctx.db,
      verifyToken: issuer.verifyToken,
      embedded: issuer,
    });
    await app.listen({ port, host: '127.0.0.1' });
    aliceId = await createPasswordUser(ctx.db, base, {
      login: 'alice@example.org',
      password: PASSWORD,
      displayName: 'Alice Annotator',
    });
  });
  afterAll(async () => {
    await app.close();
    await ctx.close();
  });

  /** Authorize, sign in on the interaction, and return the redirect the client would receive. */
  async function authorize(
    browser: Browser,
    login: string,
    password: string,
    pkce = pair(),
    redirect = redirectUri(),
  ): Promise<{ location: string; verifier: string; login: Response }> {
    const authorizeUrl =
      '/oidc/auth?' +
      query({
        client_id: EMBEDDED_CLIENT_ID,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'openid profile email offline_access',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        state: 'st',
        nonce: 'no',
      });
    const start = await browser.request(authorizeUrl);
    const interaction = start.headers.get('location') ?? '';
    expect(interaction).toMatch(/^\/oidc\/interaction\/[\w-]+$/);
    const page = await browser.request(interaction);
    expect(page.headers.get('location')).toBe(`/account/login?uid=${interaction.split('/').pop()}`);
    const login_ = await browser.postJson(`${interaction}/login`, { login, password });
    if (login_.status !== 200) return { location: '', verifier: pkce.verifier, login: login_ };
    const { redirectTo } = (await login_.json()) as { redirectTo: string };
    const resumed = await browser.request(redirectTo);
    return {
      location: resumed.headers.get('location') ?? '',
      verifier: pkce.verifier,
      login: login_,
    };
  }

  function pair(): { verifier: string; challenge: string } {
    const verifier = b64u(randomBytes(32));
    return { verifier, challenge: b64u(createHash('sha256').update(verifier).digest()) };
  }

  async function exchange(
    params: Record<string, string>,
  ): Promise<{ status: number; body: Record<string, string> }> {
    const res = await fetch(`${base}/oidc/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: query({ client_id: EMBEDDED_CLIENT_ID, ...params }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, string> };
  }

  async function signIn(login = 'alice@example.org', password = PASSWORD) {
    const browser = new Browser(base);
    const { location, verifier } = await authorize(browser, login, password);
    const code = new URL(location).searchParams.get('code') ?? '';
    const tokens = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    return { browser, location, tokens };
  }

  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/x/me', headers: { authorization: `Bearer ${token}` } });

  it('sends a configured extension the code, and its sign-out page may post towards it', async () => {
    const extension = `https://${EXTENSION_ID}.chromiumapp.org/`;
    const browser = new Browser(base);
    const { location, verifier } = await authorize(
      browser,
      'alice@example.org',
      PASSWORD,
      pair(),
      extension,
    );
    expect(location.startsWith(`${extension}?`)).toBe(true);
    const tokens = await exchange({
      grant_type: 'authorization_code',
      code: new URL(location).searchParams.get('code') ?? '',
      redirect_uri: extension,
      code_verifier: verifier,
    });
    expect(tokens.status).toBe(200);

    const out = await browser.request(
      '/oidc/session/end?' +
        query({
          id_token_hint: tokens.body['id_token'] ?? '',
          post_logout_redirect_uri: extension,
        }),
    );
    expect(out.status).toBe(200);
    // Chromium checks form-action against the redirect that follows the post.
    expect(out.headers.get('content-security-policy')).toContain(extension);
    const html = await out.text();
    const confirmed = await browser.request(/action="([^"]+)"/.exec(html)?.[1] ?? '', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: query({ xsrf: /name="xsrf" value="([^"]+)"/.exec(html)?.[1] ?? '', logout: 'yes' }),
    });
    expect(confirmed.headers.get('location')).toBe(extension);

    const unknown = await fetch(
      `${base}/oidc/auth?` +
        query({
          client_id: EMBEDDED_CLIENT_ID,
          redirect_uri: `https://${'a'.repeat(32)}.chromiumapp.org/`,
          response_type: 'code',
          scope: 'openid',
          code_challenge: pair().challenge,
          code_challenge_method: 'S256',
        }),
      { redirect: 'manual' },
    );
    expect(unknown.status).toBe(400);
  });

  it('locks a login after repeated failures from anywhere, and records no login name', async () => {
    await createPasswordUser(ctx.db, base, { login: 'target-of-guessing', password: PASSWORD });
    for (let i = 0; i < LIMITS.loginPerLogin.max; i++) {
      const wrong = await authorize(new Browser(base), 'target-of-guessing', `wrong ${i}`);
      expect(wrong.login.status).toBe(401);
    }
    const locked = await authorize(new Browser(base), 'Target-Of-Guessing', PASSWORD);
    expect(locked.login.status).toBe(429);
    expect(locked.login.headers.get('retry-after')).toBeTruthy();
    const events = await ctx.db
      .selectFrom('auth_events')
      .select(['kind', 'key', 'detail'])
      .execute();
    expect(JSON.stringify(events)).not.toContain('target-of-guessing');
  });

  it('is discoverable at the origin, with its endpoints under /oidc and no private key published', async () => {
    const res = await fetch(`${base}/.well-known/openid-configuration`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/oidc/auth`,
      token_endpoint: `${base}/oidc/token`,
      jwks_uri: `${base}/oidc/jwks`,
      end_session_endpoint: `${base}/oidc/session/end`,
    });
    expect(doc['userinfo_endpoint']).toBeUndefined();
    const jwks = (await (await fetch(`${base}/oidc/jwks`)).json()) as {
      keys: Record<string, string>[];
    };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ alg: 'ES256', use: 'sig' });
    expect(jwks.keys[0]).not.toHaveProperty('d');
  });

  it('signs a user in with a password and issues tokens the API accepts', async () => {
    const { location, tokens } = await signIn();
    expect(location).toContain(redirectUri());
    expect(new URL(location).searchParams.get('state')).toBe('st');
    expect(tokens.status).toBe(200);
    expect(tokens.body['refresh_token']).toBeTruthy();
    expect(tokens.body['id_token']).toBeTruthy();

    const access = tokens.body['access_token'] ?? '';
    const claims = decodeJwt(access);
    expect(claims).toMatchObject({ iss: base, aud: base, sub: aliceId, name: 'Alice Annotator' });
    const idClaims = decodeJwt(tokens.body['id_token'] ?? '');
    expect(idClaims).toMatchObject({ sub: aliceId, name: 'Alice Annotator', nonce: 'no' });

    const res = await me(access);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: aliceId, displayName: 'Alice Annotator' });
    // The same user next time, not a second one.
    await me(access);
    const identities = await ctx.db
      .selectFrom('identities')
      .select(['issuer', 'subject'])
      .where('principal_id', '=', aliceId)
      .execute();
    expect(identities).toEqual([{ issuer: base, subject: aliceId }]);
  });

  it('refuses a wrong password and an unknown login in the same way, and sends no code', async () => {
    const wrong = await authorize(new Browser(base), 'alice@example.org', 'not the password');
    const unknown = await authorize(new Browser(base), 'nobody@example.org', 'not the password');
    expect(wrong.login.status).toBe(401);
    expect(unknown.login.status).toBe(401);
    expect(wrong.location).toBe('');
    expect(await wrong.login.text()).toBe(await unknown.login.text());
  });

  it('accepts the login case-insensitively', async () => {
    const { tokens } = await signIn('ALICE@Example.ORG');
    expect(tokens.status).toBe(200);
  });

  it('refuses a sign-in that was not started in this browser, and one posted from another site', async () => {
    const started = new Browser(base);
    const start = await started.request(
      '/oidc/auth?' +
        query({
          client_id: EMBEDDED_CLIENT_ID,
          redirect_uri: redirectUri(),
          response_type: 'code',
          scope: 'openid',
          code_challenge: pair().challenge,
          code_challenge_method: 'S256',
        }),
    );
    const interaction = start.headers.get('location') ?? '';
    const stranger = await new Browser(base).postJson(`${interaction}/login`, {
      login: 'alice@example.org',
      password: PASSWORD,
    });
    expect(stranger.status).toBe(400);
    const crossSite = await started.postJson(
      `${interaction}/login`,
      { login: 'alice@example.org', password: PASSWORD },
      { origin: 'https://evil.example' },
    );
    expect(crossSite.status).toBe(403);
    const malformed = await started.postJson(`${interaction}/login`, {
      login: 'alice@example.org',
    });
    expect(malformed.status).toBe(400);
    // None of that spoiled the sign-in for its owner.
    const ok = await started.postJson(`${interaction}/login`, {
      login: 'alice@example.org',
      password: PASSWORD,
    });
    expect(ok.status).toBe(200);
  });

  it('requires PKCE and the registered redirect URI', async () => {
    const noPkce = await fetch(
      `${base}/oidc/auth?` +
        query({
          client_id: EMBEDDED_CLIENT_ID,
          redirect_uri: redirectUri(),
          response_type: 'code',
          scope: 'openid',
        }),
      { redirect: 'manual' },
    );
    // An error goes back to the client; the sign-in does not begin.
    expect(noPkce.headers.get('location') ?? '').not.toMatch(/\/oidc\/interaction\//);
    const wrongUri = await fetch(
      `${base}/oidc/auth?` +
        query({
          client_id: EMBEDDED_CLIENT_ID,
          redirect_uri: 'https://evil.example/cb',
          response_type: 'code',
          scope: 'openid',
          code_challenge: pair().challenge,
          code_challenge_method: 'S256',
        }),
      { redirect: 'manual' },
    );
    expect(wrongUri.status).toBe(400);
    expect(wrongUri.headers.get('location')).toBeNull();
    expect(wrongUri.headers.get('content-type')).toContain('text/html');
    expect(await wrongUri.text()).not.toContain('googleapis');

    const browser = new Browser(base);
    const { location } = await authorize(browser, 'alice@example.org', PASSWORD);
    const code = new URL(location).searchParams.get('code') ?? '';
    const bad = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: b64u(randomBytes(32)),
    });
    expect(bad.status).toBe(400);
    expect(bad.body['error']).toBe('invalid_grant');
  });

  it('renews with a rotating refresh token and treats reuse as theft', async () => {
    const { tokens } = await signIn();
    const first = tokens.body['refresh_token'] ?? '';
    const renewed = await exchange({ grant_type: 'refresh_token', refresh_token: first });
    expect(renewed.status).toBe(200);
    expect(renewed.body['refresh_token']).not.toBe(first);
    expect((await me(renewed.body['access_token'] ?? '')).statusCode).toBe(200);

    const replay = await exchange({ grant_type: 'refresh_token', refresh_token: first });
    expect(replay.status).toBe(400);
    // The grant is revoked with it.
    const after = await exchange({
      grant_type: 'refresh_token',
      refresh_token: renewed.body['refresh_token'] ?? '',
    });
    expect(after.status).toBe(400);
  });

  it('rejects tampered tokens and tokens signed with a key it does not know', async () => {
    const { tokens } = await signIn();
    const access = tokens.body['access_token'] ?? '';
    expect((await me(access.slice(0, -4) + 'AAAA')).statusCode).toBe(401);
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ name: 'Mallory' })
      .setProtectedHeader({ alg: 'ES256', kid: 'unknown' })
      .setIssuer(base)
      .setAudience(base)
      .setSubject(aliceId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    expect((await me(forged)).statusCode).toBe(401);
    expect((await me('not-a-token')).statusCode).toBe(401);
  });

  it('keeps its refresh tokens, grants and sessions in the database and no access tokens', async () => {
    await signIn();
    const types = await ctx.db.selectFrom('oidc_store').select('type').distinct().execute();
    const names = types.map((t) => t.type);
    expect(names).toEqual(expect.arrayContaining(['Session', 'Grant', 'RefreshToken']));
    expect(names).not.toContain('AccessToken');
  });

  it('signs out with a page that submits itself, under a CSP that allows only that script', async () => {
    const { browser, tokens } = await signIn();
    const out = await browser.request(
      '/oidc/session/end?' +
        query({
          id_token_hint: tokens.body['id_token'] ?? '',
          post_logout_redirect_uri: `${base}/`,
        }),
    );
    expect(out.status).toBe(200);
    expect(out.headers.get('content-security-policy')).toMatch(/script-src 'sha256-[^']+'/);
    const html = await out.text();
    expect(html).toContain('document.forms[0].submit()');
    expect(html).toContain('name="logout" value="yes"');
    const action = /action="([^"]+)"/.exec(html)?.[1] ?? '';
    const xsrf = /name="xsrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
    const confirmed = await browser.request(action, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: query({ xsrf, logout: 'yes' }),
    });
    expect(confirmed.headers.get('location')).toContain(`${base}/`);
  });
});

describe.skipIf(!databaseUrl)('signing keys and accounts', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('makes one key however many replicas start together, and stores its private half sealed', async () => {
    const all = await Promise.all([1, 2, 3, 4].map(() => loadSigningKeys(ctx.db, SECRET)));
    const kids = new Set(all.flatMap((k) => k.private.map((p) => p.kid)));
    expect(kids.size).toBe(1);
    const row = await ctx.db.selectFrom('signing_keys').selectAll().executeTakeFirstOrThrow();
    expect(row.private_jwk_encrypted).not.toContain('"d"');
    expect(JSON.stringify(row.public_jwk)).not.toContain('"d"');
    await expect(loadSigningKeys(ctx.db, `${SECRET}-other`)).rejects.toThrow();
  });

  it('keeps a long-lived key available for the full overlap after rotation', async () => {
    const before = await loadSigningKeys(ctx.db, SECRET);
    const oldKid = before.private[0]?.kid;
    const old = new Date(Date.now() - 3 * 86_400_000);
    await ctx.db
      .updateTable('signing_keys')
      .set({ created_at: old })
      .where('kid', '=', oldKid as string)
      .execute();
    const newKid = await rotateSigningKey(ctx.db, SECRET);
    const after = await loadSigningKeys(ctx.db, SECRET);
    expect(after.private[0]?.kid).toBe(newKid);
    expect(after.public.keys.map((k) => k.kid)).toEqual([newKid, oldKid]);

    // A token signed just before rotation must still verify on a fresh replica.
    const keys = await loadSigningKeys(ctx.db, SECRET);
    const oldKey = keys.private.find((k) => k.kid === oldKid);
    expect(oldKey).toBeDefined();
    const oldToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: oldKid as string })
      .setSubject('x')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(await importJWK(oldKey as JWK, 'ES256'));
    await expect(jwtVerify(oldToken, createLocalJWKSet(keys.public))).resolves.toBeDefined();
    expect(await retireOldKeys(ctx.db, 2 * 86_400_000)).toBe(0);
    await expect(
      jwtVerify(oldToken, createLocalJWKSet((await loadSigningKeys(ctx.db, SECRET)).public)),
    ).resolves.toBeDefined();
    await ctx.db
      .updateTable('signing_keys')
      .set({ created_at: new Date(Date.now() - 2 * 86_400_000 - 1000) })
      .where('kid', '=', newKid)
      .execute();
    expect(await retireOldKeys(ctx.db, 2 * 86_400_000)).toBe(1);
    expect((await loadSigningKeys(ctx.db, SECRET)).public.keys.map((k) => k.kid)).toEqual([newKid]);
    await expect(
      jwtVerify(oldToken, createLocalJWKSet((await loadSigningKeys(ctx.db, SECRET)).public)),
    ).rejects.toThrow();
  });

  it('starts the overlap again when another key is rotated in', async () => {
    const before = await loadSigningKeys(ctx.db, SECRET);
    const oldKid = before.private[0]?.kid;
    await ctx.db
      .updateTable('signing_keys')
      .set({ created_at: new Date(Date.now() - 3 * 86_400_000) })
      .where('kid', '=', oldKid as string)
      .execute();
    const previousKid = await rotateSigningKey(ctx.db, SECRET);
    await ctx.db
      .updateTable('signing_keys')
      .set({ created_at: new Date(Date.now() - 2 * 86_400_000 - 1000) })
      .where('kid', '=', previousKid)
      .execute();
    const newKid = await rotateSigningKey(ctx.db, SECRET);
    expect(await retireOldKeys(ctx.db, 2 * 86_400_000)).toBe(0);
    expect((await loadSigningKeys(ctx.db, SECRET)).public.keys.map((k) => k.kid)).toEqual([
      newKid,
      previousKid,
      oldKid,
    ]);
  });

  it('changes a password, and the old one stops working', async () => {
    await createPasswordUser(ctx.db, 'https://x.test', {
      login: 'pw@example.org',
      password: PASSWORD,
    });
    expect(await verifyLogin(ctx.db, 'pw@example.org', PASSWORD)).toBeTruthy();
    expect(await setPassword(ctx.db, 'PW@example.org', 'another long password')).toBe(true);
    expect(await verifyLogin(ctx.db, 'pw@example.org', PASSWORD)).toBeUndefined();
    expect(await verifyLogin(ctx.db, 'pw@example.org', 'another long password')).toBeTruthy();
    expect(await setPassword(ctx.db, 'nobody@example.org', 'another long password')).toBe(false);
    await expect(setPassword(ctx.db, 'pw@example.org', 'short')).rejects.toBeInstanceOf(
      AccountError,
    );
  });

  it('refuses a duplicate login, a short password and an empty login', async () => {
    await createPasswordUser(ctx.db, 'https://x.test', {
      login: 'dup@example.org',
      password: PASSWORD,
    });
    await expect(
      createPasswordUser(ctx.db, 'https://x.test', {
        login: 'DUP@example.org',
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(AccountError);
    await expect(
      createPasswordUser(ctx.db, 'https://x.test', {
        login: 'short@example.org',
        password: 'short',
      }),
    ).rejects.toBeInstanceOf(AccountError);
    await expect(
      createPasswordUser(ctx.db, 'https://x.test', { login: '  ', password: PASSWORD }),
    ).rejects.toBeInstanceOf(AccountError);
  });
});
