/**
 * Signing in through upstream providers and linking them (ADR 0028), against
 * a fake OpenID Connect provider and a fake GitHub that speak the real
 * protocols to the real client code, with a browser that keeps cookies.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_CLIENT_ID, type Config, type UpstreamProvider } from '../../../config.js';
import { buildServer } from '../../../server.js';
import { createTestContext, databaseUrl, type TestContext } from '../../../test/harness.js';
import { createTokenVerifier } from '../../verifier.js';
import { createPasswordUser } from '../accounts.js';
import { addEmail } from '../emails.js';
import type { Mailer, Message } from '../mail.js';
import { createEmbeddedIssuer } from '../provider.js';
import { createClient } from './clients.js';
import { Upstream } from './service.js';

const SECRET = 'a-test-secret-of-at-least-32-characters';
const PASSWORD = 'correct horse battery staple';

interface Person {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/** An OpenID Connect provider and a GitHub, as small as the client code allows. */
async function fakeProviders() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const otherKey = await generateKeyPair('ES256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'idp', alg: 'ES256', use: 'sig' };
  const codes = new Map<string, { person: Person; nonce: string; audience: string }>();
  const githubTokens = new Map<
    string,
    { id: number; login: string; emails: { email: string; primary: boolean; verified: boolean }[] }
  >();
  let base = '';
  let tamper: 'none' | 'nonce' | 'audience' | 'issuer' | 'expired' | 'signature' | 'discovery' =
    'none';
  let authMethod: 'client_secret_basic' | 'client_secret_post' = 'client_secret_post';

  const read = async (req: IncomingMessage): Promise<string> => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    return body;
  };
  const send = (res: ServerResponse, body: unknown, status = 200): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base);
      if (url.pathname === '/.well-known/openid-configuration') {
        return send(res, {
          issuer: tamper === 'discovery' ? 'https://another-issuer.example' : base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
          id_token_signing_alg_values_supported: ['ES256'],
          token_endpoint_auth_methods_supported: [authMethod],
        });
      }
      if (url.pathname === '/jwks') return send(res, { keys: [jwk] });
      if (url.pathname === '/token') {
        const form = new URLSearchParams(await read(req));
        const authenticated =
          authMethod === 'client_secret_basic'
            ? req.headers.authorization === `Basic ${Buffer.from('cid:s').toString('base64')}`
            : form.get('client_id') === 'cid' && form.get('client_secret') === 's';
        if (!authenticated) return send(res, { error: 'invalid_client' }, 401);
        const entry = codes.get(form.get('code') ?? '');
        if (!entry) return send(res, { error: 'invalid_grant' }, 400);
        codes.delete(form.get('code') ?? '');
        const { person } = entry;
        const idToken = await new SignJWT({
          email: person.email,
          email_verified: person.email_verified,
          name: person.name,
          nonce: tamper === 'nonce' ? 'another' : entry.nonce,
        })
          .setProtectedHeader({ alg: 'ES256', kid: 'idp' })
          .setIssuer(tamper === 'issuer' ? 'https://another-issuer.example' : base)
          .setSubject(person.sub)
          .setAudience(tamper === 'audience' ? 'someone-else' : entry.audience)
          .setIssuedAt()
          .setExpirationTime(tamper === 'expired' ? Math.floor(Date.now() / 1000) - 3600 : '5m')
          .sign(tamper === 'signature' ? otherKey.privateKey : privateKey);
        return send(res, { id_token: idToken, access_token: 'unused', token_type: 'Bearer' });
      }
      if (url.pathname === '/login/oauth/access_token') {
        const body = JSON.parse(await read(req)) as { code: string };
        return githubTokens.has(body.code)
          ? send(res, { access_token: body.code })
          : send(res, { error: 'bad_verification_code' });
      }
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const user = githubTokens.get(token);
      if (url.pathname === '/api/user' && user) {
        return send(res, {
          id: user.id,
          login: user.login,
          name: null,
          email: 'free@text.example',
        });
      }
      if (url.pathname === '/api/user/emails' && user) return send(res, user.emails);
      send(res, {}, 404);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
  return {
    base,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    /** The person the provider will say it authenticated, for the code it hands back. */
    approve(person: Person, nonce: string, audience: string): string {
      const code = randomBytes(8).toString('hex');
      codes.set(code, { person, nonce, audience });
      return code;
    },
    approveGithub(id: number, emails: { email: string; primary: boolean; verified: boolean }[]) {
      const code = randomBytes(8).toString('hex');
      githubTokens.set(code, { id, login: `user${id}`, emails });
      return code;
    },
    tamper(mode: typeof tamper) {
      tamper = mode;
    },
    authenticateWith(method: typeof authMethod) {
      authMethod = method;
    },
  };
}

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
  postJson(path: string, body: unknown): Promise<Response> {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

describe('upstream OIDC client', () => {
  let idp: Awaited<ReturnType<typeof fakeProviders>>;
  beforeAll(async () => {
    idp = await fakeProviders();
  });
  afterAll(() => idp.close());

  const client = () =>
    createClient({
      id: 'oidc',
      label: 'Campus',
      kind: 'oidc',
      issuer: idp.base,
      clientId: 'cid',
      clientSecret: 's',
    });

  it.each(['client_secret_basic', 'client_secret_post'] as const)(
    'uses the provider’s advertised %s authentication',
    async (method) => {
      idp.authenticateWith(method);
      const oidc = client();
      const redirectUri = 'http://localhost/callback';
      const to = new URL(
        await oidc.authorizeUrl({
          redirectUri,
          state: 'state',
          nonce: 'nonce',
          challenge: 'x'.repeat(43),
        }),
      );
      expect(to.searchParams.get('code_challenge_method')).toBe('S256');
      const callback = new URL(redirectUri);
      callback.search = new URLSearchParams({
        code: idp.approve(
          { sub: 'person', email: 'person@example.org', email_verified: true },
          'nonce',
          'cid',
        ),
        state: 'state',
      }).toString();
      expect(
        await oidc.exchange({
          redirectUri,
          callback,
          state: 'state',
          nonce: 'nonce',
          verifier: 'x'.repeat(43),
        }),
      ).toMatchObject({
        subject: 'person',
        email: 'person@example.org',
        emailVerified: true,
      });
    },
  );

  it('rejects discovery for another issuer and retries after discovery recovers', async () => {
    const oidc = client();
    const request = {
      redirectUri: 'http://localhost/callback',
      state: 'state',
      nonce: 'nonce',
      challenge: 'x'.repeat(43),
    };
    idp.tamper('discovery');
    await expect(oidc.authorizeUrl(request)).rejects.toThrow();
    idp.tamper('none');
    expect(new URL(await oidc.authorizeUrl(request)).origin).toBe(idp.base);
  });
});

describe.skipIf(!databaseUrl)('upstream sign-in and linking', () => {
  let ctx: TestContext;
  let idp: Awaited<ReturnType<typeof fakeProviders>>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let base = '';
  let config: Config;
  let sign: (sub: string, issuedAgoMs?: number) => Promise<string>;
  const sent: Message[] = [];
  const mailer: Mailer = {
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    ctx = await createTestContext();
    idp = await fakeProviders();
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const providers: UpstreamProvider[] = [
      {
        id: 'oidc',
        label: 'Campus',
        kind: 'oidc',
        issuer: idp.base,
        clientId: 'cid',
        clientSecret: 's',
      },
      {
        id: 'github',
        label: 'GitHub',
        kind: 'github',
        clientId: 'gid',
        clientSecret: 's',
        endpoints: {
          authorize: `${idp.base}/login/oauth/authorize`,
          token: `${idp.base}/login/oauth/access_token`,
          api: `${idp.base}/api`,
        },
      },
    ];
    config = {
      ...ctx.config,
      port,
      publicUrl: base,
      auth: {
        mode: 'embedded',
        secret: SECRET,
        extraOrigins: [],
        signup: 'approval',
        autoApproveDomains: ['trusted.example'],
        maxPending: 200,
        providers,
        autolink: [],
        smtpUrl: undefined,
        mailFrom: undefined,
        bootstrapAdminEmail: undefined,
      },
      oidc: { issuer: base, clientId: EMBEDDED_CLIENT_ID, audience: base },
    };
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const apiJwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'ES256' };
    sign = (sub, issuedAgoMs = 0) =>
      new SignJWT({ azp: EMBEDDED_CLIENT_ID })
        .setProtectedHeader({ alg: 'ES256', kid: 'k' })
        .setIssuer(base)
        .setSubject(sub)
        .setAudience(base)
        .setIssuedAt(Math.floor((Date.now() - issuedAgoMs) / 1000))
        .setExpirationTime('1h')
        .sign(privateKey);
    const issuer = await createEmbeddedIssuer({ config, db: ctx.db, mailer });
    app = await buildServer({
      config,
      db: ctx.db,
      verifyToken: createTokenVerifier({
        issuer: base,
        clientId: EMBEDDED_CLIENT_ID,
        audience: base,
        jwks: createLocalJWKSet({ keys: [apiJwk] }),
      }),
      embedded: issuer,
      authCacheMs: 0,
    });
    await app.listen({ port, host: '127.0.0.1' });
  });
  afterAll(async () => {
    await app.close();
    await idp.close();
    await ctx.close();
  });

  /** Starts a sign-in and returns the interaction the browser is in. */
  async function startSignIn(browser: Browser): Promise<string> {
    const authorize =
      '/oidc/auth?' +
      new URLSearchParams({
        client_id: EMBEDDED_CLIENT_ID,
        redirect_uri: `${base}/sidebar/popup-callback.html`,
        response_type: 'code',
        scope: 'openid profile email offline_access',
        code_challenge: 'x'.repeat(43),
        code_challenge_method: 'S256',
        state: 'st',
      }).toString();
    const interaction = (await browser.request(authorize)).headers.get('location') ?? '';
    await browser.request(interaction);
    return interaction.split('/').pop() ?? '';
  }

  /** To the provider and back, as the person `person`; returns where the callback sends the browser. */
  async function viaProvider(
    browser: Browser,
    uid: string,
    providerId: 'oidc' | 'github',
    person:
      Person | { id: number; emails: { email: string; primary: boolean; verified: boolean }[] },
  ): Promise<{ location: string; callback: string }> {
    const out = await browser.request(`/oidc/interaction/${uid}/upstream/${providerId}`);
    expect(out.status).toBe(302);
    const to = new URL(out.headers.get('location') ?? '');
    expect(to.origin).toBe(idp.base);
    const code =
      'sub' in person
        ? idp.approve(person, to.searchParams.get('nonce') ?? '', 'cid')
        : idp.approveGithub(person.id, person.emails);
    const callback = `${to.searchParams.get('redirect_uri')}?code=${code}&state=${to.searchParams.get('state')}`;
    const back = await browser.request(callback);
    return { location: back.headers.get('location') ?? '', callback };
  }

  /** Follows a ticket to the end of the interaction: the client's redirect with a code. */
  async function finish(browser: Browser, location: string): Promise<string> {
    expect(location).toMatch(/^\/oidc\/interaction\/[\w-]+\/finish\?ticket=/);
    const resume = (await browser.request(location)).headers.get('location') ?? '';
    const done = await browser.request(resume);
    return done.headers.get('location') ?? '';
  }

  const principalOf = async (provider: string, subject: string): Promise<string | undefined> =>
    (
      await ctx.db
        .selectFrom('linked_accounts')
        .select('principal_id')
        .where('provider', '=', provider)
        .where('external_subject', '=', subject)
        .executeTakeFirst()
    )?.principal_id;

  const meAs = async (id: string, issuedAgoMs = 0) =>
    app.inject({
      method: 'GET',
      url: '/x/me',
      headers: { authorization: `Bearer ${await sign(id, issuedAgoMs)}` },
    });

  describe('a new person', () => {
    it('is queued for approval under the default policy, and signs in again as the same user', async () => {
      const person = {
        sub: 'g-1',
        email: 'newbie@example.org',
        email_verified: true,
        name: 'Newbie',
      };
      const first = new Browser(base);
      const uid = await startSignIn(first);
      const { location } = await viaProvider(first, uid, 'oidc', person);
      expect(await finish(first, location)).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/sidebar\/popup-callback\.html\?code=/,
      );

      const id = (await principalOf('oidc', 'g-1')) as string;
      const me = (await meAs(id)).json<{ status: string; displayName: string; email: string }>();
      expect(me).toMatchObject({
        status: 'pending',
        displayName: 'Newbie',
        email: 'newbie@example.org',
      });
      const application = await ctx.db
        .selectFrom('applications')
        .select(['decision', 'note'])
        .where('principal_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(application).toEqual({ decision: null, note: 'Signed up with Campus' });
      const email = await ctx.db
        .selectFrom('user_emails')
        .select(['verified_at', 'is_primary'])
        .where('principal_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(email.verified_at).not.toBeNull();

      const second = new Browser(base);
      const again = await viaProvider(second, await startSignIn(second), 'oidc', person);
      await finish(second, again.location);
      const users = await ctx.db
        .selectFrom('users')
        .select('principal_id')
        .where('email', '=', 'newbie@example.org')
        .execute();
      expect(users).toHaveLength(1);
    });

    it('is approved at once when the provider verifies an address in an approved domain', async () => {
      const browser = new Browser(base);
      const { location } = await viaProvider(browser, await startSignIn(browser), 'oidc', {
        sub: 'g-trusted',
        email: 'colleague@trusted.example',
        email_verified: true,
        name: 'Colleague',
      });
      await finish(browser, location);
      const id = (await principalOf('oidc', 'g-trusted')) as string;
      expect((await meAs(id)).json<{ status: string }>().status).toBe('active');
      const application = await ctx.db
        .selectFrom('applications')
        .select(['decision', 'decision_note', 'decided_at'])
        .where('principal_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(application).toMatchObject({
        decision: 'approved',
        decision_note: 'Verified address in an approved domain',
      });
      expect(application.decided_at).not.toBeNull();
    });

    it('does not believe an address the provider does not vouch for', async () => {
      const browser = new Browser(base);
      const { location } = await viaProvider(browser, await startSignIn(browser), 'oidc', {
        sub: 'g-liar',
        email: 'newbie@example.org',
        email_verified: false,
        name: 'Impostor',
      });
      await finish(browser, location);
      const mine = (await principalOf('oidc', 'g-liar')) as string;
      const theirs = (await principalOf('oidc', 'g-1')) as string;
      expect(mine).not.toBe(theirs);
      const owned = await ctx.db
        .selectFrom('user_emails')
        .select('principal_id')
        .where('email', '=', 'newbie@example.org')
        .execute();
      expect(owned.map((r) => r.principal_id)).toEqual([theirs]);
    });

    it('uses only the verified primary address from GitHub', async () => {
      const browser = new Browser(base);
      const { location } = await viaProvider(browser, await startSignIn(browser), 'github', {
        id: 77,
        emails: [
          { email: 'unverified@example.org', primary: false, verified: false },
          { email: 'gh@example.org', primary: true, verified: true },
        ],
      });
      await finish(browser, location);
      const id = (await principalOf('github', '77')) as string;
      expect((await meAs(id)).json<{ email: string }>().email).toBe('gh@example.org');
      const none = new Browser(base);
      const bare = await viaProvider(none, await startSignIn(none), 'github', {
        id: 78,
        emails: [{ email: 'nope@example.org', primary: true, verified: false }],
      });
      await finish(none, bare.location);
      const bareId = (await principalOf('github', '78')) as string;
      expect((await meAs(bareId)).json<{ email?: string }>().email).toBeUndefined();
    });
  });

  describe('an address that already has an account', () => {
    let ownerId = '';
    const identity: Person = {
      sub: 'g-owner',
      email: 'owner@example.org',
      email_verified: true,
      name: 'Owner',
    };
    beforeAll(async () => {
      ownerId = await createPasswordUser(ctx.db, base, {
        login: 'owner@example.org',
        password: PASSWORD,
        displayName: 'Owner',
        emailVerified: true,
      });
    });

    it('attaches nothing until the owner signs in with their password, in the same browser', async () => {
      const browser = new Browser(base);
      const uid = await startSignIn(browser);
      const { location } = await viaProvider(browser, uid, 'oidc', identity);
      expect(location).toMatch(new RegExp(`^/account/login\\?uid=${uid}&link=`));
      const link = new URL(location, base).searchParams.get('link') as string;
      expect(await principalOf('oidc', 'g-owner')).toBeUndefined();

      // The page can ask what is being connected, from this browser only.
      const info = await browser.request(`/auth/upstream/pending/${link}?uid=${uid}`);
      expect(await info.json()).toEqual({
        provider: 'oidc',
        label: 'Campus',
        email: 'owner@example.org',
      });
      const stranger = new Browser(base);
      expect((await stranger.request(`/auth/upstream/pending/${link}?uid=${uid}`)).status).toBe(
        404,
      );

      // The wrong password attaches nothing and does not spend the request.
      const wrong = await browser.postJson(`/oidc/interaction/${uid}/login`, {
        login: 'owner@example.org',
        password: 'nope nope nope',
        link,
      });
      expect(wrong.status).toBe(401);
      expect(await principalOf('oidc', 'g-owner')).toBeUndefined();

      const ok = await browser.postJson(`/oidc/interaction/${uid}/login`, {
        login: 'owner@example.org',
        password: PASSWORD,
        link,
      });
      expect(ok.status).toBe(200);
      expect(await principalOf('oidc', 'g-owner')).toBe(ownerId);

      // From now on the provider signs in as the owner.
      const later = new Browser(base);
      const again = await viaProvider(later, await startSignIn(later), 'oidc', identity);
      await finish(later, again.location);
      expect(await principalOf('oidc', 'g-owner')).toBe(ownerId);
      const count = await ctx.db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('email', '=', 'owner@example.org')
        .executeTakeFirstOrThrow();
      expect(count.n).toBe('1');
    });

    it('does not attach when a different account is signed in to, and spends the request', async () => {
      const otherId = await createPasswordUser(ctx.db, base, {
        login: 'other@example.org',
        password: PASSWORD,
        emailVerified: true,
      });
      await ctx.db
        .deleteFrom('linked_accounts')
        .where('external_subject', '=', 'g-owner')
        .execute();
      const browser = new Browser(base);
      const uid = await startSignIn(browser);
      const { location } = await viaProvider(browser, uid, 'oidc', identity);
      const link = new URL(location, base).searchParams.get('link') as string;
      const ok = await browser.postJson(`/oidc/interaction/${uid}/login`, {
        login: 'other@example.org',
        password: PASSWORD,
        link,
      });
      expect(ok.status).toBe(200);
      expect(await principalOf('oidc', 'g-owner')).toBeUndefined();
      expect(otherId).not.toBe(ownerId);
      const spent = await browser.request(`/auth/upstream/pending/${link}?uid=${uid}`);
      expect(spent.status).toBe(404);
    });

    it('refuses a pending link used from another browser', async () => {
      const browser = new Browser(base);
      const uid = await startSignIn(browser);
      const { location } = await viaProvider(browser, uid, 'oidc', identity);
      const link = new URL(location, base).searchParams.get('link') as string;
      // The thief has the link id and even a sign-in of their own, but not the first browser's cookie.
      const thief = new Browser(base);
      const thiefUid = await startSignIn(thief);
      const attempt = await thief.postJson(`/oidc/interaction/${thiefUid}/login`, {
        login: 'owner@example.org',
        password: PASSWORD,
        link,
      });
      expect(attempt.status).toBe(200);
      expect(await principalOf('oidc', 'g-owner')).toBeUndefined();
    });

    it('says to sign in the old way when the account has no password to prove ownership with', async () => {
      const passwordless = new Browser(base);
      const first = await viaProvider(passwordless, await startSignIn(passwordless), 'oidc', {
        sub: 'g-pl',
        email: 'pl@example.org',
        email_verified: true,
        name: 'PL',
      });
      await finish(passwordless, first.location);
      await ctx.db
        .updateTable('users')
        .set({ status: 'active' })
        .where('email', '=', 'pl@example.org')
        .execute();
      const another = new Browser(base);
      const clash = await viaProvider(another, await startSignIn(another), 'github', {
        id: 90,
        emails: [{ email: 'pl@example.org', primary: true, verified: true }],
      });
      expect(clash.location).toMatch(/error=use-existing/);
      expect(await principalOf('github', '90')).toBeUndefined();
    });
  });

  describe('hostile callbacks', () => {
    it('does not accept a callback twice, or from another browser, or with a state of its own making', async () => {
      const person: Person = {
        sub: 'g-replay',
        email: 'replay@example.org',
        email_verified: true,
        name: 'R',
      };
      const browser = new Browser(base);
      const uid = await startSignIn(browser);
      const first = await viaProvider(browser, uid, 'oidc', person);
      await finish(browser, first.location);
      // The same URL again: the state is used up.
      const replay = await browser.request(first.callback);
      expect(replay.headers.get('location')).toMatch(/error=expired/);

      // A callback delivered to a browser that did not start the trip.
      const owner = new Browser(base);
      const ownerUid = await startSignIn(owner);
      const out = await owner.request(`/oidc/interaction/${ownerUid}/upstream/oidc`);
      const to = new URL(out.headers.get('location') ?? '');
      const code = idp.approve({ sub: 'g-victim' }, to.searchParams.get('nonce') ?? '', 'cid');
      const attacker = new Browser(base);
      const stolen = await attacker.request(
        `${to.searchParams.get('redirect_uri')}?code=${code}&state=${to.searchParams.get('state')}`,
      );
      expect(stolen.headers.get('location')).toMatch(/error=browser/);
      expect(await principalOf('oidc', 'g-victim')).toBeUndefined();

      // Never started here.
      const forged = await new Browser(base).request(
        `/auth/upstream/oidc/callback?code=x&state=${randomBytes(8).toString('hex')}`,
      );
      expect(forged.headers.get('location')).toMatch(/error=expired/);
    });

    it('does not let a ticket be used twice or in another browser', async () => {
      const browser = new Browser(base);
      const uid = await startSignIn(browser);
      const { location } = await viaProvider(browser, uid, 'oidc', { sub: 'g-ticket', name: 'T' });
      const other = new Browser(base);
      const stolen = await other.request(location);
      expect(stolen.headers.get('location')).toMatch(/error=expired/);
      await finish(browser, location);
      const reused = await browser.request(location);
      expect(reused.headers.get('location')).toMatch(/error=expired/);
    });

    it('turns away invalid ID tokens and a provider that says no', async () => {
      for (const mode of ['audience', 'nonce', 'issuer', 'expired', 'signature'] as const) {
        idp.tamper(mode);
        const browser = new Browser(base);
        const { location } = await viaProvider(browser, await startSignIn(browser), 'oidc', {
          sub: `g-${mode}`,
        });
        expect(location).toMatch(/error=failed/);
        expect(await principalOf('oidc', `g-${mode}`)).toBeUndefined();
      }
      idp.tamper('none');
      const browser = new Browser(base);
      const uid = await startSignIn(browser);
      const out = await browser.request(`/oidc/interaction/${uid}/upstream/oidc`);
      const to = new URL(out.headers.get('location') ?? '');
      const denied = await browser.request(
        `${to.searchParams.get('redirect_uri')}?error=access_denied&state=${to.searchParams.get('state')}`,
      );
      expect(denied.headers.get('location')).toMatch(/error=denied/);
    });

    it('does not sign in a disabled user', async () => {
      const browser = new Browser(base);
      const first = await viaProvider(browser, await startSignIn(browser), 'oidc', {
        sub: 'g-off',
        name: 'Off',
      });
      await finish(browser, first.location);
      await ctx.db
        .updateTable('users')
        .set({ status: 'disabled' })
        .where('principal_id', '=', (await principalOf('oidc', 'g-off')) as string)
        .execute();
      const again = new Browser(base);
      const result = await viaProvider(again, await startSignIn(again), 'oidc', {
        sub: 'g-off',
        name: 'Off',
      });
      expect(result.location).toMatch(/error=disabled/);
    });
  });

  describe('connecting and disconnecting while signed in', () => {
    let userId = '';
    let bearer = '';
    beforeAll(async () => {
      userId = await createPasswordUser(ctx.db, base, {
        login: 'joiner@example.org',
        password: PASSWORD,
        displayName: 'Joiner',
        emailVerified: true,
      });
      bearer = await sign(userId);
    });
    const post = (url: string, payload: object, token = bearer) =>
      app.inject({
        method: 'POST',
        url,
        payload: payload as Record<string, unknown>,
        headers: { authorization: `Bearer ${token}` },
      });

    async function connect(
      person: Person,
      token = bearer,
      password: string | undefined = PASSWORD,
    ) {
      const started = await post(
        '/auth/links/oidc/start',
        password === undefined ? {} : { password },
        token,
      );
      if (started.statusCode !== 200) return { started };
      const browser = new Browser(base);
      // The start response sets the cookie the callback must present.
      const cookie = (started.headers['set-cookie'] as string).split(';')[0] ?? '';
      const to = new URL(started.json<{ url: string }>().url);
      const code = idp.approve(person, to.searchParams.get('nonce') ?? '', 'cid');
      const back = await fetch(
        `${to.searchParams.get('redirect_uri')}?code=${code}&state=${to.searchParams.get('state')}`,
        {
          redirect: 'manual',
          headers: { cookie },
        },
      );
      void browser;
      return { started, location: back.headers.get('location') ?? '' };
    }

    it('asks for the password again before connecting, then attaches the identity', async () => {
      expect(
        (await post('/auth/links/oidc/start', { password: 'wrong wrong wrong' })).statusCode,
      ).toBe(400);
      expect((await post('/auth/links/oidc/start', {})).statusCode).toBe(400);
      const { location } = await connect({
        sub: 'g-join',
        email: 'joiner@elsewhere.example',
        email_verified: true,
      });
      expect(location).toBe('/me?linked=1');
      expect(await principalOf('oidc', 'g-join')).toBe(userId);
      const account = await app.inject({
        method: 'GET',
        url: '/auth/account',
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(
        account.json<{ links: { provider: string }[]; providers: { id: string }[] }>(),
      ).toMatchObject({
        links: [{ provider: 'oidc', label: 'Campus' }],
        providers: [{ id: 'oidc' }, { id: 'github' }],
      });
    });

    it.each([false, true])(
      'uses the first provider-verified email in the profile (previously added: %s)',
      async (alreadyAdded) => {
        const id = await createPasswordUser(ctx.db, base, {
          login: `username-only-${alreadyAdded}`,
          password: PASSWORD,
        });
        const email = `first-provider-${alreadyAdded}@example.org`;
        if (alreadyAdded) await addEmail(ctx.db, id, email);
        expect(
          (
            await connect(
              {
                sub: `g-first-email-${alreadyAdded}`,
                email,
                email_verified: true,
              },
              await sign(id),
            )
          ).location,
        ).toBe('/me?linked=1');
        const headers = { authorization: `Bearer ${await sign(id)}` };
        const account = await app.inject({ method: 'GET', url: '/idp/account', headers });
        expect(account.json()).toMatchObject({
          emails: [{ email, verified: true, primary: true }],
        });
        expect((await app.inject({ method: 'GET', url: '/x/me', headers })).json()).toMatchObject({
          email,
        });
      },
    );

    it('refuses an identity another account has, pointing nowhere useful to an attacker', async () => {
      const { location } = await connect({ sub: 'g-1' });
      expect(location).toBe('/me?link_error=owned');
      const ownerLink = await principalOf('oidc', 'g-1');
      expect(ownerLink).not.toBe(userId);
    });

    it('cannot be completed from a browser that did not start it', async () => {
      const started = await post('/auth/links/oidc/start', { password: PASSWORD });
      const to = new URL(started.json<{ url: string }>().url);
      const code = idp.approve({ sub: 'g-fixation' }, to.searchParams.get('nonce') ?? '', 'cid');
      const other = new Browser(base);
      const back = await other.request(
        `${to.searchParams.get('redirect_uri')}?code=${code}&state=${to.searchParams.get('state')}`,
      );
      expect(back.headers.get('location')).toMatch(/link_error=browser/);
      expect(await principalOf('oidc', 'g-fixation')).toBeUndefined();
    });

    it('unlinks with the password, and never removes the last way in', async () => {
      expect(
        (await post('/auth/links/oidc/unlink', { password: 'wrong wrong wrong' })).statusCode,
      ).toBe(400);
      expect((await post('/auth/links/oidc/unlink', { password: PASSWORD })).statusCode).toBe(200);
      expect(await principalOf('oidc', 'g-join')).toBeUndefined();
      expect((await post('/auth/links/oidc/unlink', { password: PASSWORD })).statusCode).toBe(404);

      // A person with only a provider cannot unlink it; with a recent sign-in they can connect another.
      const pl = (await principalOf('oidc', 'g-pl')) as string;
      await ctx.db
        .updateTable('users')
        .set({ status: 'active' })
        .where('principal_id', '=', pl)
        .execute();
      const stale = await sign(pl, 3600_000 * 0.5);
      expect((await post('/auth/links/oidc/start', {}, stale)).statusCode).toBe(403);
      const only = await post('/auth/links/oidc/unlink', {}, await sign(pl));
      expect(only.statusCode).toBe(409);
      const fresh = await connect({ sub: 'g-pl-2' }, await sign(pl), undefined);
      expect(fresh.location).toBe('/me?linked=1');
      // Two identities at one provider are still one way in, as far as removing that provider goes.
      expect((await post('/auth/links/oidc/unlink', {}, await sign(pl))).statusCode).toBe(409);
      expect(await principalOf('oidc', 'g-pl')).toBe(pl);
    });

    it('does not let a pending user change how the account is signed in to', async () => {
      const waiting = (await principalOf('oidc', 'g-1')) as string;
      expect((await post('/auth/links/oidc/start', {}, await sign(waiting))).statusCode).toBe(403);
    });
  });

  describe('the sign-up policy for a new provider identity', () => {
    const profile: Person = {
      sub: 'p-1',
      email: 'policy@example.org',
      email_verified: true,
      name: 'Policy',
    };
    const fake = {
      authorizeUrl: () => Promise.resolve(''),
      exchange: () => Promise.reject(new Error('unused')),
    };
    const make = (auth: Partial<Config['auth']>) =>
      new Upstream({
        db: ctx.db,
        origin: base,
        auth: { ...config.auth, ...auth },
        clientFor: () => fake,
      });
    const signIn = (u: Upstream, p: Person = profile) =>
      (
        u as unknown as {
          signIn(
            provider: string,
            profile: unknown,
            uid: string,
            binding: string,
          ): Promise<{ kind: string; code?: string }>;
        }
      ).signIn(
        'oidc',
        { subject: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name },
        'uid',
        'binding',
      );

    it('refuses strangers when closed, but takes someone invited at their verified address, as an administrator if invited as one', async () => {
      const closed = make({ signup: 'closed' });
      expect(await signIn(closed)).toMatchObject({ kind: 'error', code: 'closed' });
      await ctx.db
        .insertInto('account_tokens')
        .values({
          token_hash: randomBytes(8).toString('hex'),
          purpose: 'invite',
          email: 'Policy@Example.org',
          is_admin: true,
          expires_at: new Date(Date.now() + 3600_000),
        })
        .execute();
      expect(await signIn(closed)).toMatchObject({ kind: 'ticket' });
      const id = (await principalOf('oidc', 'p-1')) as string;
      const user = await ctx.db
        .selectFrom('users')
        .select(['status', 'is_admin'])
        .where('principal_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(user).toEqual({ status: 'active', is_admin: true });
      const used = await ctx.db
        .selectFrom('account_tokens')
        .select('used_at')
        .where('email', '=', 'Policy@Example.org')
        .executeTakeFirstOrThrow();
      expect(used.used_at).not.toBeNull();
    });

    it('activates at once when open, and pauses at the cap', async () => {
      expect(await signIn(make({ signup: 'open' }), { sub: 'p-2', name: 'Two' })).toMatchObject({
        kind: 'ticket',
      });
      const two = (await principalOf('oidc', 'p-2')) as string;
      expect((await meAs(two)).json<{ status: string }>().status).toBe('active');
      expect(
        await signIn(make({ signup: 'approval', maxPending: 0 }), { sub: 'p-3', name: 'Three' }),
      ).toMatchObject({ kind: 'error', code: 'paused' });
      expect(await principalOf('oidc', 'p-3')).toBeUndefined();
    });

    it('joins an existing account without asking only for a provider on the autolink list', async () => {
      await createPasswordUser(ctx.db, base, {
        login: 'auto@example.org',
        password: PASSWORD,
        emailVerified: true,
      });
      const person: Person = { sub: 'p-auto', email: 'auto@example.org', email_verified: true };
      expect(await signIn(make({ autolink: [] }), person)).toMatchObject({ kind: 'pending-link' });
      expect(await principalOf('oidc', 'p-auto')).toBeUndefined();
      expect(await signIn(make({ autolink: ['oidc'] }), person)).toMatchObject({ kind: 'ticket' });
      expect(await principalOf('oidc', 'p-auto')).toBeDefined();
    });
  });
});
