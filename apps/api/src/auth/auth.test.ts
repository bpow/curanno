/**
 * OIDC bearer tokens: validation against the issuer's keys and first-sight
 * user creation. Group membership and administration are managed entirely
 * through our own API (ADR 0026), not derived from the token.
 */
import { SignJWT, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENT_ID,
  ISSUER,
  alice,
  bob,
  createTestContext,
  databaseUrl,
  root,
  type TestContext,
} from '../test/harness.js';

describe.skipIf(!databaseUrl)('authentication', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('creates the user on first sight, with no groups and no administration', async () => {
    const res = await ctx.as(alice, { method: 'GET', url: '/x/me' });
    expect(res.statusCode).toBe(200);
    const me = res.json<{
      id: string;
      displayName: string;
      isAdmin: boolean;
      groups: { name: string }[];
    }>();
    expect(me.displayName).toBe('Alice Annotator');
    expect(me.isAdmin).toBe(false);
    expect(me.groups).toEqual([]);
    const again = await ctx.as(alice, { method: 'GET', url: '/x/me' });
    expect(again.json<{ id: string }>().id).toBe(me.id);
    const users = await ctx.db.selectFrom('users').select('subject').execute();
    expect(users.map((u) => u.subject)).toEqual(['alice']);
  });

  it('shows a user their own email and memberships, and other users neither', async () => {
    const created = await ctx.as(alice, {
      method: 'POST',
      url: '/x/groups',
      payload: { name: 'Project X' },
    });
    expect(created.statusCode).toBe(201);
    const me = await ctx.as(
      { ...alice, email: 'alice@partner.example' },
      { method: 'GET', url: '/x/me' },
    );
    const aliceId = me.json<{ id: string; email?: string; groups: unknown[] }>();
    expect(aliceId.email).toBe('alice@partner.example');
    expect(aliceId.groups.length).toBeGreaterThan(0);
    const seenByBob = await ctx.as(bob, { method: 'GET', url: `/x/users/${aliceId.id}` });
    const other = seenByBob.json<{ email?: string; groups: unknown[] }>();
    expect(other.email).toBeUndefined();
    expect(other.groups).toEqual([]);
    // Principal search matches display names, never email addresses.
    const byEmail = await ctx.as(bob, { method: 'GET', url: '/x/principals?q=partner.example' });
    expect(byEmail.json<unknown[]>()).toEqual([]);
    const byName = await ctx.as(bob, { method: 'GET', url: '/x/principals?q=alice' });
    expect(byName.json<{ name?: string }[]>().map((p) => p.name)).toEqual(['Alice Annotator']);
  });

  it('manages administrators through is_admin, bootstrapped directly for the first one', async () => {
    await ctx.as(root, { method: 'GET', url: '/x/me' });
    await ctx.db
      .updateTable('users')
      .set({ is_admin: true })
      .where('subject', '=', root.sub)
      .execute();
    const admin = await ctx.as(root, { method: 'GET', url: '/x/me' });
    expect(admin.json<{ isAdmin: boolean }>().isAdmin).toBe(true);
    const list = await ctx.as(root, { method: 'GET', url: '/x/users' });
    expect(list.statusCode).toBe(200);
    const forbidden = await ctx.as(bob, { method: 'GET', url: '/x/users' });
    expect(forbidden.statusCode).toBe(403);

    const bobMe = await ctx.as(bob, { method: 'GET', url: '/x/me' });
    const bobId = bobMe.json<{ id: string }>().id;
    const promoted = await ctx.as(root, {
      method: 'PATCH',
      url: `/x/users/${bobId}`,
      payload: { isAdmin: true },
    });
    expect(promoted.json<{ isAdmin: boolean }>().isAdmin).toBe(true);
    const demoted = await ctx.as(root, {
      method: 'PATCH',
      url: `/x/users/${bobId}`,
      payload: { isAdmin: false },
    });
    expect(demoted.json<{ isAdmin: boolean }>().isAdmin).toBe(false);
  });

  it('rejects tokens from another issuer, for another audience, or expired', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ azp: CLIENT_ID })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer(ISSUER)
      .setSubject('mallory')
      .setAudience(CLIENT_ID)
      .setExpirationTime('1h')
      .sign(privateKey);
    const bad = await ctx.app.inject({
      method: 'GET',
      url: '/x/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json<{ detail: string }>().detail).toMatch(/invalid bearer token/);

    const token = await ctx.token(alice);
    const [header, , signature] = token.split('.');
    const otherAudience = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        sub: 'alice',
        aud: 'someone-else',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');
    const tampered = await ctx.app.inject({
      method: 'GET',
      url: '/x/me',
      headers: { authorization: `Bearer ${header}.${otherAudience}.${signature}` },
    });
    expect(tampered.statusCode).toBe(401);

    const anonymousWrite = await ctx.app.inject({ method: 'GET', url: '/x/me' });
    expect(anonymousWrite.statusCode).toBe(401);
    const anonymousRead = await ctx.app.inject({ method: 'GET', url: '/x/profiles' });
    expect(anonymousRead.statusCode).toBe(200);
  });
});
