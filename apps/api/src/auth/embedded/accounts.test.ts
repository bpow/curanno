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
import { decideApplication, purgeApplications } from '../../accounts/applications.js';
import { createPasswordUser, signUp, SignupRefused, verifyLogin } from './accounts.js';
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
        signup: 'approval',
        autoApproveDomains: ['trusted.example'],
        maxPending: 200,
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

  describe('sign-up with approval', () => {
    let adminId = '';
    beforeAll(async () => {
      adminId = await createPasswordUser(ctx.db, ORIGIN, {
        login: 'chief@example.org',
        password: PASSWORD,
        displayName: 'Chief',
        emailVerified: true,
        isAdmin: true,
      });
    });

    const signup = (email: string, extra: object = {}, ip = '10.4.0.1') =>
      post(
        '/auth/signup',
        { email, password: PASSWORD, displayName: 'Applicant', note: 'Please', ...extra },
        undefined,
        ip,
      );
    const meAs = async (id: string) =>
      app.inject({
        method: 'GET',
        url: '/x/me',
        headers: { authorization: `Bearer ${await sign(id)}` },
      });

    it('leaves the applicant pending, tells the administrators and mails a verification link', async () => {
      sent.length = 0;
      const res = await signup('applicant@example.org');
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'pending' });
      expect(sent.map((m) => m.to).sort()).toEqual([
        'applicant@example.org',
        'boss@example.org',
        'chief@example.org',
      ]);
      expect(sent.find((m) => m.to === 'chief@example.org')?.text).toContain('/applications');
      const id = await verifyLogin(ctx.db, 'applicant@example.org', PASSWORD);
      expect(id).toBeDefined();
      const row = await ctx.db
        .selectFrom('applications')
        .select(['decision', 'note'])
        .where('principal_id', '=', id as string)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ decision: null, note: 'Please' });
    });

    it('treats a pending user as the public: told their status, refused writes, allowed public reads', async () => {
      const id = (await verifyLogin(ctx.db, 'applicant@example.org', PASSWORD)) as string;
      const me = await meAs(id);
      expect(me.statusCode).toBe(200);
      expect(me.json<{ status: string }>().status).toBe('pending');
      const bearer = { authorization: `Bearer ${await sign(id)}` };
      const write = await app.inject({
        method: 'POST',
        url: '/x/groups',
        payload: { name: 'Sneaky' },
        headers: bearer,
      });
      expect(write.statusCode).toBe(403);
      expect(write.json<{ detail: string }>().detail).toMatch(/waiting for approval/);
      const read = await app.inject({ method: 'GET', url: '/x/profiles', headers: bearer });
      expect(read.statusCode).toBe(200);
      const users = await app.inject({ method: 'GET', url: '/x/users', headers: bearer });
      expect(users.statusCode).toBe(403);
      const account = await app.inject({ method: 'GET', url: '/auth/account', headers: bearer });
      expect(account.statusCode).toBe(403);
    });

    it('lets an administrator approve, after which the applicant acts as themself', async () => {
      const id = (await verifyLogin(ctx.db, 'applicant@example.org', PASSWORD)) as string;
      const application = await ctx.db
        .selectFrom('applications')
        .select('id')
        .where('principal_id', '=', id)
        .executeTakeFirstOrThrow();
      const decided = await app.inject({
        method: 'PATCH',
        url: `/x/applications/${application.id}`,
        payload: { decision: 'approved', note: 'Welcome aboard' },
        headers: { authorization: `Bearer ${await sign(adminId)}` },
      });
      expect(decided.statusCode).toBe(200);
      expect(
        sent.find((m) => m.to === 'applicant@example.org' && /approved/.test(m.subject))?.text,
      ).toContain('Welcome aboard');
      expect((await meAs(id)).json<{ status: string }>().status).toBe('active');
      const write = await app.inject({
        method: 'POST',
        url: '/x/groups',
        payload: { name: 'Applicants group' },
        headers: { authorization: `Bearer ${await sign(id)}` },
      });
      expect(write.statusCode).toBe(201);
    });

    it('approves at once an applicant who verifies an address in an approved domain', async () => {
      sent.length = 0;
      await signup('colleague@trusted.example', {}, '10.4.0.2');
      const verification = sent.find((m) => m.to === 'colleague@trusted.example');
      const id = (await verifyLogin(ctx.db, 'colleague@trusted.example', PASSWORD)) as string;
      expect((await meAs(id)).json<{ status: string }>().status).toBe('pending');
      expect(
        (await post('/auth/email/verify', { token: tokenOf(linkIn(verification)) })).statusCode,
      ).toBe(200);
      expect((await meAs(id)).json<{ status: string }>().status).toBe('active');
      const application = await ctx.db
        .selectFrom('applications')
        .select(['decision', 'decided_by'])
        .where('principal_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(application).toEqual({ decision: 'approved', decided_by: null });
    });

    it('answers the same for an address that has an account, and tells its owner instead', async () => {
      sent.length = 0;
      const known = await signup('chief@example.org', {}, '10.4.0.3');
      const fresh = await signup('another@example.org', {}, '10.4.0.4');
      expect(known.statusCode).toBe(202);
      expect(known.body).toBe(fresh.body);
      const notice = sent.find((m) => m.to === 'chief@example.org');
      expect(notice?.subject).toMatch(/used your address/);
    });

    it('limits sign-ups from one address', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) {
        codes.push((await signup(`flood${i}@example.org`, {}, '10.4.0.9')).statusCode);
      }
      expect(codes.filter((c) => c === 202)).toHaveLength(5);
      expect(codes.filter((c) => c === 429)).toHaveLength(2);
    });

    it('refuses a weak password and an unknown field shape without creating anyone', async () => {
      const before = await ctx.db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      expect((await signup('weak@example.org', { password: 'short' }, '10.4.0.5')).statusCode).toBe(
        400,
      );
      expect(
        (
          await post(
            '/auth/signup',
            { email: 'not-an-email', password: PASSWORD, displayName: 'x' },
            undefined,
            '10.4.0.6',
          )
        ).statusCode,
      ).toBe(400);
      const after = await ctx.db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      expect(after.n).toBe(before.n);
    });

    it('stops taking applications at the cap, and activates at once under open sign-up', async () => {
      const waiting = await ctx.db
        .selectFrom('applications')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('decision', 'is', null)
        .executeTakeFirstOrThrow();
      await expect(
        signUp(
          ctx.db,
          ORIGIN,
          { login: 'capped@example.org', password: PASSWORD, displayName: 'C' },
          { approval: true, maxPending: Number(waiting.n) },
        ),
      ).rejects.toBeInstanceOf(SignupRefused);
      const open = await signUp(
        ctx.db,
        ORIGIN,
        { login: 'open@example.org', password: PASSWORD, displayName: 'O' },
        { approval: false, maxPending: 0 },
      );
      expect(open.applicationId).toBeUndefined();
      const user = await ctx.db
        .selectFrom('users')
        .select('status')
        .where('principal_id', '=', open.principalId)
        .executeTakeFirstOrThrow();
      expect(user.status).toBe('active');
    });

    it('does not let a disabled user sign in, and purges rejected and stale applicants after their time', async () => {
      const id = await createPasswordUser(ctx.db, ORIGIN, {
        login: 'banned@example.org',
        password: PASSWORD,
      });
      await ctx.db
        .updateTable('users')
        .set({ status: 'disabled' })
        .where('principal_id', '=', id)
        .execute();
      expect(await verifyLogin(ctx.db, 'banned@example.org', PASSWORD)).toBeUndefined();

      const rejected = await signUp(
        ctx.db,
        ORIGIN,
        { login: 'nope@example.org', password: PASSWORD, displayName: 'N' },
        { approval: true, maxPending: 1000 },
      );
      await decideApplication(
        ctx.db,
        rejected.applicationId as string,
        'rejected',
        adminId,
        undefined,
      );
      const stale = await signUp(
        ctx.db,
        ORIGIN,
        { login: 'forgotten@example.org', password: PASSWORD, displayName: 'F' },
        { approval: true, maxPending: 1000 },
      );
      expect(await purgeApplications(ctx.db, { retentionDays: 30, staleDays: 14 })).toBe(0);
      const old = new Date(Date.now() - 40 * 24 * 3600_000);
      await ctx.db
        .updateTable('applications')
        .set({ decided_at: old })
        .where('id', '=', rejected.applicationId as string)
        .execute();
      await ctx.db
        .updateTable('applications')
        .set({ created_at: old })
        .where('id', '=', stale.applicationId as string)
        .execute();
      expect(await purgeApplications(ctx.db, { retentionDays: 30, staleDays: 14 })).toBe(2);
      const left = await ctx.db
        .selectFrom('users')
        .select('principal_id')
        .where('principal_id', 'in', [rejected.principalId, stale.principalId])
        .execute();
      expect(left).toEqual([]);
    });
  });

  describe('tokens for missing accounts', () => {
    it.each(['pending', 'rejected'] as const)(
      'rejects a still-valid token after a %s applicant is purged',
      async (status) => {
        const applicant = await signUp(
          ctx.db,
          ORIGIN,
          { login: `purged-${status}@example.org`, password: PASSWORD, displayName: status },
          { approval: true, maxPending: 1000 },
        );
        const applicationId = applicant.applicationId as string;
        if (status === 'rejected') {
          await decideApplication(ctx.db, applicationId, 'rejected', null, undefined);
        }
        const headers = { authorization: `Bearer ${await sign(applicant.principalId)}` };
        const me = await app.inject({ method: 'GET', url: '/x/me', headers });
        expect(me.statusCode).toBe(200);
        expect(me.json<{ status: string }>().status).toBe(status);
        const write = () =>
          app.inject({
            method: 'POST',
            url: '/x/groups',
            payload: { name: `Purged ${status}` },
            headers,
          });
        expect((await write()).statusCode).toBe(403);

        const old = new Date(Date.now() - 40 * 24 * 3600_000);
        await ctx.db
          .updateTable('applications')
          .set({ created_at: old, ...(status === 'rejected' ? { decided_at: old } : {}) })
          .where('id', '=', applicationId)
          .execute();
        expect(await purgeApplications(ctx.db, { retentionDays: 30, staleDays: 14 })).toBe(1);

        expect((await app.inject({ method: 'GET', url: '/x/me', headers })).statusCode).toBe(401);
        expect((await write()).statusCode).toBe(401);
        expect(
          await ctx.db
            .selectFrom('identities')
            .select('principal_id')
            .where('issuer', '=', ORIGIN)
            .where('subject', '=', applicant.principalId)
            .executeTakeFirst(),
        ).toBeUndefined();
        expect(
          await ctx.db
            .selectFrom('users')
            .select('principal_id')
            .where('issuer', '=', ORIGIN)
            .where('subject', '=', applicant.principalId)
            .executeTakeFirst(),
        ).toBeUndefined();
      },
    );
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
