/**
 * Invitations, password reset, address verification, the account page and the
 * throttling of guesses (ADR 0028), over the routes a browser would call.
 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_CLIENT_ID, type Config } from '../../config.js';
import { buildServer } from '../../server.js';
import { createTestContext, databaseUrl, type TestContext } from '../../test/harness.js';
import { createTokenVerifier } from '../verifier.js';
import { createPasswordUser, verifyLogin } from './accounts.js';
import { ensureBootstrapAdmin, createInvite } from './invites.js';
import type { Mailer, Message } from './mail.js';
import { createEmbeddedIssuer, type EmbeddedIssuer } from './provider.js';
import { LIMITS } from './throttle.js';

const SECRET = 'a-test-secret-of-at-least-32-characters';
const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'http://localhost:3999';

describe.skipIf(!databaseUrl)('embedded accounts', () => {
  let ctx: TestContext;
  let issuer: EmbeddedIssuer;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let config: Config;
  let sign: (sub: string) => Promise<string>;
  const sent: Message[] = [];
  const mailer: Mailer = {
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    ctx = await createTestContext();
    config = {
      ...ctx.config,
      publicUrl: ORIGIN,
      auth: {
        mode: 'embedded',
        secret: SECRET,
        extraOrigins: [],
        smtpUrl: undefined,
        mailFrom: undefined,
        bootstrapAdminEmail: undefined,
      },
      oidc: { issuer: ORIGIN, clientId: EMBEDDED_CLIENT_ID, audience: ORIGIN },
    };
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'ES256' };
    sign = (sub) =>
      new SignJWT({ azp: EMBEDDED_CLIENT_ID })
        .setProtectedHeader({ alg: 'ES256', kid: 'k' })
        .setIssuer(ORIGIN)
        .setSubject(sub)
        .setAudience(ORIGIN)
        .setExpirationTime('1h')
        .sign(privateKey);
    issuer = await createEmbeddedIssuer({ config, db: ctx.db, mailer });
    app = await buildServer({
      config,
      db: ctx.db,
      verifyToken: createTokenVerifier({
        issuer: ORIGIN,
        clientId: EMBEDDED_CLIENT_ID,
        audience: ORIGIN,
        jwks: createLocalJWKSet({ keys: [jwk] }),
      }),
      embedded: issuer,
      authCacheMs: 0,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await ctx.close();
  });

  const post = (url: string, payload: unknown, token?: string, ip = '10.0.0.1') =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      remoteAddress: ip,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const tokenOf = (link: string): string => new URL(link).searchParams.get('token') ?? '';
  const linkIn = (message: Message | undefined): string =>
    /https?:\/\/\S+/.exec(message?.text ?? '')?.[0] ?? '';

  describe('invitations', () => {
    it('lets the invited person choose a password, once, and signs them in with it', async () => {
      const link = await createInvite(ctx.db, ORIGIN, { email: 'newcomer@example.org' });
      expect(link).toMatch(/^http:\/\/localhost:3999\/account\/invite\?token=/);
      const token = tokenOf(link);
      const peek = await post('/auth/invite/peek', { token });
      expect(peek.json()).toEqual({ email: 'newcomer@example.org' });

      const short = await post('/auth/invite/accept', {
        token,
        password: 'short',
        displayName: 'N',
      });
      expect(short.statusCode).toBe(400);
      // A bad password does not use the link up.
      const accepted = await post('/auth/invite/accept', {
        token,
        password: PASSWORD,
        displayName: 'New Comer',
      });
      expect(accepted.statusCode).toBe(201);
      const principal = await verifyLogin(ctx.db, 'Newcomer@Example.org', PASSWORD);
      expect(principal).toBeDefined();
      const user = await ctx.db
        .selectFrom('users')
        .select(['display_name', 'email', 'is_admin'])
        .where('principal_id', '=', principal as string)
        .executeTakeFirstOrThrow();
      expect(user).toEqual({
        display_name: 'New Comer',
        email: 'newcomer@example.org',
        is_admin: false,
      });
      const emails = await ctx.db
        .selectFrom('user_emails')
        .select(['verified_at', 'is_primary'])
        .where('principal_id', '=', principal as string)
        .executeTakeFirstOrThrow();
      expect(emails.verified_at).not.toBeNull();
      expect(emails.is_primary).toBe(true);

      const again = await post('/auth/invite/accept', {
        token,
        password: PASSWORD,
        displayName: 'x',
      });
      expect(again.statusCode).toBe(400);
      expect((await post('/auth/invite/peek', { token })).statusCode).toBe(400);
    });

    it('can make the new user an administrator, and refuses an address that has an account', async () => {
      const link = await createInvite(ctx.db, ORIGIN, { email: 'boss@example.org', isAdmin: true });
      await post('/auth/invite/accept', {
        token: tokenOf(link),
        password: PASSWORD,
        displayName: 'Boss',
      });
      const row = await ctx.db
        .selectFrom('users')
        .select('is_admin')
        .where('email', '=', 'boss@example.org')
        .executeTakeFirstOrThrow();
      expect(row.is_admin).toBe(true);
      await expect(createInvite(ctx.db, ORIGIN, { email: 'BOSS@example.org' })).rejects.toThrow(
        /already has an account/,
      );
    });

    it('does not honour an expired link or one made for another purpose', async () => {
      const token = tokenOf(await createInvite(ctx.db, ORIGIN, { email: 'late@example.org' }));
      await ctx.db
        .updateTable('account_tokens')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('email', '=', 'late@example.org')
        .execute();
      expect(
        (await post('/auth/invite/accept', { token, password: PASSWORD, displayName: '' }))
          .statusCode,
      ).toBe(400);
      expect((await post('/auth/reset/complete', { token, password: PASSWORD })).statusCode).toBe(
        400,
      );
    });

    it('rejects a request from another site', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/invite/peek',
        payload: { token: 'x' },
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('password reset', () => {
    let principalId = '';
    beforeAll(async () => {
      principalId = await createPasswordUser(ctx.db, ORIGIN, {
        login: 'forgetful@example.org',
        password: PASSWORD,
        displayName: 'Forgetful',
        emailVerified: true,
      });
    });

    it('answers the same for an address with an account and one without, and mails only the first', async () => {
      sent.length = 0;
      const known = await post(
        '/auth/reset/request',
        { email: 'Forgetful@example.org' },
        undefined,
        '10.1.0.1',
      );
      const unknown = await post(
        '/auth/reset/request',
        { email: 'nobody@example.org' },
        undefined,
        '10.1.0.2',
      );
      expect(known.statusCode).toBe(202);
      expect(unknown.statusCode).toBe(202);
      expect(known.body).toBe(unknown.body);
      expect(sent.map((m) => m.to)).toEqual(['forgetful@example.org']);
    });

    it('sets the new password once and ends the sessions of the old one', async () => {
      sent.length = 0;
      await post('/auth/reset/request', { email: 'forgetful@example.org' }, undefined, '10.1.0.3');
      const token = tokenOf(linkIn(sent[0]));
      await ctx.db
        .insertInto('oidc_store')
        .values({
          id: 'session-1',
          type: 'Session',
          payload: JSON.stringify({ accountId: principalId }),
        })
        .execute();
      // Too short: refused without using the link.
      expect((await post('/auth/reset/complete', { token, password: 'short' })).statusCode).toBe(
        400,
      );
      expect(
        (await post('/auth/reset/complete', { token, password: 'a brand new passphrase' }))
          .statusCode,
      ).toBe(200);
      expect(await verifyLogin(ctx.db, 'forgetful@example.org', PASSWORD)).toBeUndefined();
      expect(await verifyLogin(ctx.db, 'forgetful@example.org', 'a brand new passphrase')).toBe(
        principalId,
      );
      const left = await ctx.db
        .selectFrom('oidc_store')
        .select('id')
        .where('id', '=', 'session-1')
        .execute();
      expect(left).toEqual([]);
      expect(
        (await post('/auth/reset/complete', { token, password: 'another passphrase here' }))
          .statusCode,
      ).toBe(400);
    });

    it('limits requests for one address, silently', async () => {
      await createPasswordUser(ctx.db, ORIGIN, {
        login: 'limited@example.org',
        password: PASSWORD,
        emailVerified: true,
      });
      sent.length = 0;
      for (let i = 0; i < LIMITS.resetPerEmail.max + 2; i++) {
        const res = await post(
          '/auth/reset/request',
          { email: 'limited@example.org' },
          undefined,
          `10.2.0.${i + 1}`,
        );
        expect(res.statusCode).toBe(202);
      }
      expect(sent).toHaveLength(LIMITS.resetPerEmail.max);
    });
  });

  describe('the account page', () => {
    let principalId = '';
    let bearer = '';
    beforeAll(async () => {
      principalId = await createPasswordUser(ctx.db, ORIGIN, {
        login: 'pat',
        password: PASSWORD,
        displayName: 'Pat',
      });
      bearer = await sign(principalId);
    });

    it('requires a signed-in user', async () => {
      expect((await app.inject({ method: 'GET', url: '/auth/account' })).statusCode).toBe(401);
      expect((await post('/auth/password', { current: 'a', next: 'b' })).statusCode).toBe(401);
    });

    it('changes the password only when the current one is given, and throttles wrong guesses', async () => {
      const wrong = await post(
        '/auth/password',
        { current: 'not it', next: 'whatever long enough' },
        bearer,
      );
      expect(wrong.statusCode).toBe(400);
      const ok = await post(
        '/auth/password',
        { current: PASSWORD, next: 'a second passphrase!' },
        bearer,
      );
      expect(ok.statusCode).toBe(200);
      expect(await verifyLogin(ctx.db, 'pat', 'a second passphrase!')).toBe(principalId);
      for (let i = 0; i < LIMITS.passwordPerUser.max; i++) {
        await post('/auth/password', { current: 'guess', next: 'whatever long enough' }, bearer);
      }
      const locked = await post(
        '/auth/password',
        { current: 'a second passphrase!', next: 'yet another one!!' },
        bearer,
      );
      expect(locked.statusCode).toBe(429);
      expect(locked.headers['retry-after']).toBeDefined();
    });

    it('adds an address, verifies it by link, and makes the first verified one primary', async () => {
      sent.length = 0;
      expect((await post('/auth/emails', { email: 'pat@example.org' }, bearer)).statusCode).toBe(
        202,
      );
      let account = (
        await app.inject({
          method: 'GET',
          url: '/auth/account',
          headers: { authorization: `Bearer ${bearer}` },
        })
      ).json<{
        login: string;
        emails: { email: string; verified: boolean; primary: boolean }[];
      }>();
      expect(account.login).toBe('pat');
      expect(account.emails).toEqual([
        { email: 'pat@example.org', verified: false, primary: false },
      ]);

      const token = tokenOf(linkIn(sent[0]));
      expect((await post('/auth/email/verify', { token })).statusCode).toBe(200);
      account = (
        await app.inject({
          method: 'GET',
          url: '/auth/account',
          headers: { authorization: `Bearer ${bearer}` },
        })
      ).json();
      expect(account.emails).toEqual([{ email: 'pat@example.org', verified: true, primary: true }]);
      const user = await ctx.db
        .selectFrom('users')
        .select('email')
        .where('principal_id', '=', principalId)
        .executeTakeFirstOrThrow();
      expect(user.email).toBe('pat@example.org');
      expect((await post('/auth/email/verify', { token })).statusCode).toBe(400);
    });

    it('does not tell whether another account already has the address, and sends it nothing', async () => {
      sent.length = 0;
      const res = await post('/auth/emails', { email: 'boss@example.org' }, bearer);
      expect(res.statusCode).toBe(202);
      expect(sent).toEqual([]);
    });

    it('refuses to remove the primary address, and removes another', async () => {
      sent.length = 0;
      await post('/auth/emails', { email: 'pat2@example.org' }, bearer);
      expect(
        (await post('/auth/emails/remove', { email: 'pat@example.org' }, bearer)).statusCode,
      ).toBe(404);
      expect(
        (await post('/auth/emails/primary', { email: 'pat2@example.org' }, bearer)).statusCode,
      ).toBe(404);
      expect(
        (await post('/auth/emails/remove', { email: 'pat2@example.org' }, bearer)).statusCode,
      ).toBe(200);
    });
  });

  describe('the first administrator', () => {
    it('is invited by the configured address while there is none, and only once', async () => {
      await ctx.db.updateTable('users').set({ is_admin: false }).execute();
      const logged: string[] = [];
      const options = {
        email: 'first@example.org',
        publicUrl: ORIGIN,
        mailer: undefined,
        log: { info: (m: string) => logged.push(m) },
      };
      await ensureBootstrapAdmin(ctx.db, options);
      await ensureBootstrapAdmin(ctx.db, options);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('/account/invite?token=');
      sent.length = 0;
      await ctx.db.deleteFrom('account_tokens').where('email', '=', 'first@example.org').execute();
      await ensureBootstrapAdmin(ctx.db, { ...options, mailer });
      expect(sent.map((m) => m.to)).toEqual(['first@example.org']);
    });
  });
});
