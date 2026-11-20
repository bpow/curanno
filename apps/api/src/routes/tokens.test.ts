/**
 * Access tokens, service accounts and the suggester role (ADR 0038).
 */
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { individualProfile } from '@curanno/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alice,
  annotationOn,
  bob,
  carol,
  createTestContext,
  databaseUrl,
  root,
  type TestContext,
  type TestUser,
} from '../test/harness.js';

const PAGE = 'https://journal.example/tokens';

describe.skipIf(!databaseUrl)('access tokens', () => {
  let ctx: TestContext;
  const ids = new Map<TestUser, string>();
  let group: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    for (const user of [alice, bob, carol, root]) {
      const me = await ctx.as(user, { method: 'GET', url: '/x/me' });
      ids.set(user, me.json<{ id: string }>().id);
    }
    await ctx.db
      .updateTable('users')
      .set({ is_admin: true })
      .where('principal_id', '=', ids.get(root)!)
      .execute();
    const created = await ctx.as(alice, {
      method: 'POST',
      url: '/x/groups',
      payload: { name: 'Token group' },
    });
    group = created.json<{ id: string }>().id;
  });
  afterAll(() => ctx.close());

  const bearer = (token: string, options: InjectOptions): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });
  async function tokenFor(
    as: TestUser,
    userId: string,
    name = 'a job',
    scopes = ['suggestions:write'],
  ) {
    const res = await ctx.as(as, {
      method: 'POST',
      url: `/x/users/${userId}/tokens`,
      payload: { name, scopes, expiresInDays: 30 },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string; token: string }>();
  }
  const batch = (
    items = [
      {
        id: '_:i1',
        selector: { type: 'TextQuoteSelector', exact: 'II-1' },
        body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: 'II-1' } },
      },
    ],
  ) => ({
    method: 'POST' as const,
    url: '/x/suggestion-batches',
    payload: {
      group,
      document: { uri: PAGE, links: [] },
      engine: { name: 'nightly', version: '1' },
      items,
    },
  });

  it('gives the secret once and reaches only what its scopes allow', async () => {
    const { id, token } = await tokenFor(alice, ids.get(alice)!);
    expect(token).toMatch(/^cat_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    const listed = await ctx.as(alice, { method: 'GET', url: `/x/users/${ids.get(alice)}/tokens` });
    expect(listed.json()).toEqual([
      expect.objectContaining({ id, name: 'a job', scopes: ['suggestions:write'] }),
    ]);
    expect(listed.body).not.toContain(token.slice(-43));

    expect((await bearer(token, { method: 'GET', url: '/x/me' })).json<{ id: string }>().id).toBe(
      ids.get(alice),
    );
    expect((await bearer(token, batch())).statusCode).toBe(201);
    expect((await bearer(token, { method: 'GET', url: '/x/groups' })).statusCode).toBe(403);
    expect((await bearer(token, { method: 'GET', url: '/x/profiles' })).statusCode).toBe(200);
    expect(
      (await bearer(token, { method: 'GET', url: '/x/resolve/variant?q=c.1A%3EG' })).statusCode,
    ).toBe(200);
    expect(
      (await bearer(token, { method: 'POST', url: '/annotations/', payload: annotationOn(PAGE) }))
        .statusCode,
    ).toBe(403);
    const used = await ctx.as(alice, { method: 'GET', url: `/x/users/${ids.get(alice)}/tokens` });
    expect(used.json<{ lastUsed?: string }[]>()[0]?.lastUsed).toBeDefined();
  });

  it('reads and writes annotations as its user with the annotation scopes', async () => {
    const write = await tokenFor(bob, ids.get(bob)!, 'migration', ['annotations:write']);
    const made = await bearer(write.token, {
      method: 'POST',
      url: '/annotations/',
      payload: annotationOn(PAGE, 'Migrated'),
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json<{ id: string }>().id.split('/').pop();
    const shared = await bearer(write.token, {
      method: 'PUT',
      url: `/x/annotations/${id}/acl`,
      payload: [{ principal: group, permission: 'read' }],
    });
    expect(shared.statusCode, shared.body).toBe(200);
    const direct = await ctx.as(bob, {
      method: 'POST',
      url: '/annotations/',
      payload: annotationOn(PAGE),
    });
    const read = await ctx.as(bob, { method: 'GET', url: `/annotations/${id}` });
    expect(read.json<{ creator: unknown }>().creator).toEqual(
      direct.json<{ creator: unknown }>().creator,
    );

    const reader = await tokenFor(bob, ids.get(bob)!, 'reader', ['annotations:read']);
    expect(
      (await bearer(reader.token, { method: 'GET', url: `/annotations/${id}` })).statusCode,
    ).toBe(200);
    const found = await bearer(reader.token, {
      method: 'GET',
      url: `/x/search?uri=${encodeURIComponent(PAGE)}`,
    });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.body).toContain(id);
    expect(
      (
        await bearer(reader.token, {
          method: 'POST',
          url: '/annotations/',
          payload: annotationOn(PAGE),
        })
      ).statusCode,
    ).toBe(403);
    expect((await bearer(reader.token, batch())).statusCode).toBe(403);
    expect((await bearer(write.token, { method: 'GET', url: '/x/groups' })).statusCode).toBe(403);
  });

  it('stops working when revoked, expired, tampered with, or its user is disabled', async () => {
    const revoked = await tokenFor(bob, ids.get(bob)!);
    expect(
      (
        await ctx.as(bob, {
          method: 'DELETE',
          url: `/x/users/${ids.get(bob)}/tokens/${revoked.id}`,
        })
      ).statusCode,
    ).toBe(204);
    expect((await bearer(revoked.token, { method: 'GET', url: '/x/me' })).statusCode).toBe(401);

    const expired = await tokenFor(bob, ids.get(bob)!);
    await ctx.db
      .updateTable('access_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', expired.id)
      .execute();
    expect((await bearer(expired.token, { method: 'GET', url: '/x/me' })).statusCode).toBe(401);

    const live = await tokenFor(bob, ids.get(bob)!);
    const tampered = `${live.token.slice(0, -1)}${live.token.endsWith('A') ? 'B' : 'A'}`;
    expect((await bearer(tampered, { method: 'GET', url: '/x/me' })).statusCode).toBe(401);
    expect((await bearer('cat_nonsense', { method: 'GET', url: '/x/me' })).statusCode).toBe(401);

    expect((await bearer(live.token, { method: 'GET', url: '/x/me' })).statusCode).toBe(200);
    await ctx.as(root, {
      method: 'PATCH',
      url: `/x/users/${ids.get(bob)}`,
      payload: { status: 'disabled' },
    });
    expect((await bearer(live.token, { method: 'GET', url: '/x/me' })).statusCode).toBe(401);
    await ctx.as(root, {
      method: 'PATCH',
      url: `/x/users/${ids.get(bob)}`,
      payload: { status: 'active' },
    });
  });

  it("keeps a person's tokens their own and administrators'", async () => {
    const own = await tokenFor(carol, ids.get(carol)!);
    expect(
      (await ctx.as(bob, { method: 'GET', url: `/x/users/${ids.get(carol)}/tokens` })).statusCode,
    ).toBe(404);
    expect(
      (await ctx.as(bob, { method: 'DELETE', url: `/x/users/${ids.get(carol)}/tokens/${own.id}` }))
        .statusCode,
    ).toBe(404);
    expect(
      (await ctx.as(root, { method: 'GET', url: `/x/users/${ids.get(carol)}/tokens` })).statusCode,
    ).toBe(200);
    // An administrator does not make tokens that act as a person.
    const made = await ctx.as(root, {
      method: 'POST',
      url: `/x/users/${ids.get(carol)}/tokens`,
      payload: { name: 'x', scopes: ['suggestions:write'], expiresInDays: 1 },
    });
    expect(made.statusCode).toBe(403);
    expect(
      (await ctx.as(root, { method: 'DELETE', url: `/x/users/${ids.get(carol)}/tokens/${own.id}` }))
        .statusCode,
    ).toBe(204);
  });

  it('lets a service account post for a group as its suggester, and see only what it posted', async () => {
    const created = await ctx.as(root, {
      method: 'POST',
      url: '/x/users',
      payload: { displayName: 'Nightly run' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const service = created.json<{ id: string; service: boolean; isAdmin: boolean }>();
    expect(service).toMatchObject({ service: true, isAdmin: false });
    expect(
      (
        await ctx.as(root, {
          method: 'PATCH',
          url: `/x/users/${service.id}`,
          payload: { isAdmin: true },
        })
      ).statusCode,
    ).toBe(409);
    const { token } = await tokenFor(root, service.id, 'nightly');

    expect((await bearer(token, batch())).statusCode).toBe(403);
    const role = await ctx.as(alice, {
      method: 'PUT',
      url: `/x/groups/${group}/members/${service.id}`,
      payload: { role: 'suggester' },
    });
    expect(role.statusCode, role.body).toBe(204);
    const posted = await bearer(token, batch());
    expect(posted.statusCode, posted.body).toBe(201);
    const mine = posted.json<{ id: string }>().id;
    expect(
      (await bearer(token, { method: 'GET', url: `/x/suggestion-batches/${mine}` })).statusCode,
    ).toBe(200);
    // Not decisions, and not the batches others posted for the group.
    expect(
      (
        await bearer(token, {
          method: 'POST',
          url: `/x/suggestion-batches/${mine}/reject`,
          payload: { items: ['_:i1'] },
        })
      ).statusCode,
    ).toBe(403);
    const listed = await bearer(token, {
      method: 'GET',
      url: `/x/suggestion-batches?group=${group}`,
    });
    expect(listed.json<{ items: { id: string }[] }>().items.map((b) => b.id)).toEqual([mine]);
    // Members still review it.
    expect(
      (await ctx.as(alice, { method: 'GET', url: `/x/suggestion-batches/${mine}` })).statusCode,
    ).toBe(200);
  });

  it('does not make a suggester a member of the group', async () => {
    const role = await ctx.as(alice, {
      method: 'PUT',
      url: `/x/groups/${group}/members/${ids.get(carol)}`,
      payload: { role: 'suggester' },
    });
    expect(role.statusCode).toBe(204);
    const note = await ctx.as(alice, {
      method: 'POST',
      url: '/annotations/',
      payload: annotationOn(PAGE, 'For the group'),
    });
    const noteId = note.json<{ id: string }>().id.split('/').pop();
    await ctx.as(alice, {
      method: 'PUT',
      url: `/x/annotations/${noteId}/acl`,
      payload: [{ principal: group, permission: 'read' }],
    });
    expect((await ctx.as(carol, { method: 'GET', url: `/annotations/${noteId}` })).statusCode).toBe(
      404,
    );
    expect((await ctx.as(carol, { method: 'GET', url: `/x/groups/${group}` })).statusCode).toBe(
      404,
    );
    expect(
      (await ctx.as(carol, { method: 'GET', url: `/x/groups/${group}/members` })).statusCode,
    ).toBe(403);
    expect((await ctx.as(carol, batch())).statusCode).toBe(201);
  });
});
