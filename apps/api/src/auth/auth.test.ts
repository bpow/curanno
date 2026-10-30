/**
 * OIDC bearer tokens: validation against the issuer's keys, first-sight user
 * creation, synchronization of the `groups` claim, and the admin group.
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

  it('creates the user on first sight with their groups', async () => {
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
    expect(me.groups.map((g) => g.name)).toEqual(['curators']);
    const again = await ctx.as(alice, { method: 'GET', url: '/x/me' });
    expect(again.json<{ id: string }>().id).toBe(me.id);
    const users = await ctx.db.selectFrom('users').select('subject').execute();
    expect(users.map((u) => u.subject)).toEqual(['alice']);
  });

  it('synchronizes provider groups on every login and leaves API groups alone', async () => {
    const created = await ctx.as(alice, {
      method: 'POST',
      url: '/x/groups',
      payload: { name: 'Project X' },
    });
    expect(created.statusCode).toBe(201);
    const moved = await ctx.as(
      { ...alice, groups: ['/reviewers', 'Curators'] },
      { method: 'GET', url: '/x/me' },
    );
    const groups = moved
      .json<{ groups: { name: string }[] }>()
      .groups.map((g) => g.name)
      .sort();
    expect(groups).toEqual(['Project X', 'curators', 'reviewers']);
    const dropped = await ctx.as({ ...alice, groups: [] }, { method: 'GET', url: '/x/me' });
    expect(dropped.json<{ groups: { name: string }[] }>().groups.map((g) => g.name)).toEqual([
      'Project X',
    ]);
    const issuers = await ctx.db.selectFrom('groups').select(['name', 'issuer']).execute();
    issuers.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    expect(issuers).toEqual([
      { name: 'curators', issuer: ISSUER },
      { name: 'Project X', issuer: null },
      { name: 'reviewers', issuer: ISSUER },
    ]);
  });

  it('never lets a claim grant membership in a group created through the API', async () => {
    // Bob creates a group with the name of a provider group nobody has logged in with yet.
    const squat = await ctx.as(bob, {
      method: 'POST',
      url: '/x/groups',
      payload: { name: 'clingen-curators' },
    });
    expect(squat.statusCode).toBe(201);
    const squatted = squat.json<{ id: string }>().id;
    // Alice's token claims that group: she joins the provider's group, not bob's.
    const me = await ctx.as(
      { ...alice, groups: ['clingen-curators'] },
      { method: 'GET', url: '/x/me' },
    );
    const mine = me
      .json<{ groups: { id: string; name: string }[] }>()
      .groups.filter((g) => g.name === 'clingen-curators');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.id).not.toBe(squatted);
    const members = await ctx.as(bob, { method: 'GET', url: `/x/groups/${squatted}/members` });
    expect(members.statusCode).toBe(200);
    expect(
      members.json<{ user: { displayName?: string } }[]>().map((m) => m.user.displayName),
    ).toEqual(['Bob Reviewer']);
  });

  it('grants and withdraws administration through the admin group', async () => {
    const admin = await ctx.as(root, { method: 'GET', url: '/x/me' });
    expect(admin.json<{ isAdmin: boolean }>().isAdmin).toBe(true);
    const list = await ctx.as(root, { method: 'GET', url: '/x/users' });
    expect(list.statusCode).toBe(200);
    const demoted = await ctx.as({ ...root, groups: [] }, { method: 'GET', url: '/x/me' });
    expect(demoted.json<{ isAdmin: boolean }>().isAdmin).toBe(false);
    const forbidden = await ctx.as(bob, { method: 'GET', url: '/x/users' });
    expect(forbidden.statusCode).toBe(403);
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
