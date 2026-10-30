/**
 * Multi-principal access control (ADR 0006, success criterion 4): several
 * users and groups, and what each can see and do through every read and
 * write path. The event stream has its own suite in events.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTHENTICATED_PRINCIPAL_ID, PUBLIC_PRINCIPAL_ID } from '../db/index.js';
import {
  alice,
  annotationOn,
  bob,
  carol,
  createTestContext,
  databaseUrl,
  type TestContext,
  type TestUser,
} from '../test/harness.js';

const PAGE = 'https://example.org/shared';
const LD_JSON = { 'content-type': 'application/ld+json' };

interface Created {
  id: string;
  iri: string;
  etag: string;
}

describe.skipIf(!databaseUrl)('access control', () => {
  let ctx: TestContext;
  let curators: string;
  let aliceId: string;
  let bobId: string;
  const anns: Record<string, Created> = {};

  async function create(user: TestUser, text: string): Promise<Created> {
    const res = await ctx.as(user, {
      method: 'POST',
      url: '/annotations/',
      headers: LD_JSON,
      payload: annotationOn(PAGE, text),
    });
    expect(res.statusCode).toBe(201);
    const iri = res.json<{ id: string }>().id;
    return { id: iri.split('/').pop() as string, iri, etag: res.headers['etag'] as string };
  }

  async function grant(user: TestUser, ann: Created, principal: string, permission: string) {
    const res = await ctx.as(user, {
      method: 'POST',
      url: `/x/annotations/${ann.id}/acl`,
      payload: { principal, permission },
    });
    expect(res.statusCode).toBe(201);
  }

  async function visible(user: TestUser | null, ann: Created): Promise<number> {
    return (await ctx.as(user, { method: 'GET', url: `/annotations/${ann.id}` })).statusCode;
  }

  async function searchIds(user: TestUser | null, url: string): Promise<string[]> {
    const res = await ctx.as(user, { method: 'GET', url });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: { id: string }[]; first?: { items: string[] } }>();
    return (body.items ?? body.first?.items ?? []).map((i) => (typeof i === 'string' ? i : i.id));
  }

  beforeAll(async () => {
    ctx = await createTestContext();
    // Log everybody in once so that users and groups exist.
    for (const user of [alice, bob, carol]) {
      expect((await ctx.as(user, { method: 'GET', url: '/x/me' })).statusCode).toBe(200);
    }
    const me = await ctx.as(alice, { method: 'GET', url: '/x/me' });
    const aliceUser = me.json<{ id: string; groups: { id: string; name: string }[] }>();
    aliceId = aliceUser.id;
    curators = aliceUser.groups.find((g) => g.name === 'curators')?.id as string;
    bobId = (await ctx.as(bob, { method: 'GET', url: '/x/me' })).json<{ id: string }>().id;

    anns['private'] = await create(alice, 'private to alice');
    anns['public'] = await create(alice, 'public');
    await grant(alice, anns['public'], PUBLIC_PRINCIPAL_ID, 'read');
    anns['authenticated'] = await create(alice, 'any logged-in user');
    await grant(alice, anns['authenticated'], AUTHENTICATED_PRINCIPAL_ID, 'read');
    anns['curators'] = await create(alice, 'curators only');
    await grant(alice, anns['curators'], curators, 'read');
    anns['bobs'] = await create(bob, 'bob shares with alice');
    await grant(bob, anns['bobs'], aliceId, 'read');
    await grant(bob, anns['bobs'], aliceId, 'update');
  });
  afterAll(() => ctx.close());

  it('shows each caller exactly the annotations they may read', async () => {
    const expectations: [TestUser | null, Record<string, number>][] = [
      [null, { private: 404, public: 200, authenticated: 404, curators: 404, bobs: 404 }],
      [bob, { private: 404, public: 200, authenticated: 200, curators: 404, bobs: 200 }],
      [carol, { private: 404, public: 200, authenticated: 200, curators: 200, bobs: 404 }],
      [alice, { private: 200, public: 200, authenticated: 200, curators: 200, bobs: 200 }],
    ];
    for (const [user, expected] of expectations) {
      for (const [name, status] of Object.entries(expected)) {
        expect(
          await visible(user, anns[name] as Created),
          `${user?.sub ?? 'anonymous'} on ${name}`,
        ).toBe(status);
      }
    }
  });

  it('filters the container listing and search the same way', async () => {
    const readable = (names: string[]) => names.map((n) => (anns[n] as Created).iri).sort();
    const cases: [TestUser | null, string[]][] = [
      [null, ['public']],
      [bob, ['public', 'authenticated', 'bobs']],
      [carol, ['public', 'authenticated', 'curators']],
      [alice, ['private', 'public', 'authenticated', 'curators', 'bobs']],
    ];
    for (const [user, names] of cases) {
      const label = user?.sub ?? 'anonymous';
      expect((await searchIds(user, '/annotations/')).sort(), `container for ${label}`).toEqual(
        readable(names),
      );
      expect(
        (await searchIds(user, `/x/search?uri=${encodeURIComponent(PAGE)}`)).sort(),
        `search for ${label}`,
      ).toEqual(readable(names));
      const container = await ctx.as(user, { method: 'GET', url: '/annotations/' });
      expect(container.json<{ total: number }>().total, `total for ${label}`).toBe(names.length);
      const search = await ctx.as(user, { method: 'GET', url: '/x/search?text=alice' });
      expect(search.json<{ total: number }>().total, `text search for ${label}`).toBe(
        names.filter((n) => n === 'private' || n === 'bobs').length,
      );
    }
  });

  it('reports the permissions each caller holds', async () => {
    const forAlice = await ctx.as(alice, {
      method: 'GET',
      url: `/annotations/${anns['bobs']?.id}`,
    });
    expect(forAlice.json<{ permissions: string[] }>().permissions).toEqual(['read', 'update']);
    const forBob = await ctx.as(bob, { method: 'GET', url: `/annotations/${anns['public']?.id}` });
    expect(forBob.json<{ permissions: string[] }>().permissions).toEqual(['read']);
  });

  it('enforces update and delete permissions separately from read', async () => {
    const bobs = anns['bobs'] as Created;
    const update = (user: TestUser | null, ann: Created, etag = '*') =>
      ctx.as(user, {
        method: 'PUT',
        url: `/annotations/${ann.id}`,
        headers: { ...LD_JSON, 'if-match': etag },
        payload: annotationOn(PAGE, 'edited'),
      });
    expect((await update(alice, bobs)).statusCode).toBe(200);
    expect((await update(bob, anns['public'] as Created)).statusCode).toBe(403);
    expect((await update(carol, anns['curators'] as Created)).statusCode).toBe(403);
    expect((await update(carol, anns['private'] as Created)).statusCode).toBe(404);
    expect((await update(null, anns['public'] as Created)).statusCode).toBe(401);

    const del = (user: TestUser | null, ann: Created) =>
      ctx.as(user, {
        method: 'DELETE',
        url: `/annotations/${ann.id}`,
        headers: { 'if-match': '*' },
      });
    expect((await del(alice, bobs)).statusCode).toBe(403);
    expect((await del(carol, anns['curators'] as Created)).statusCode).toBe(403);
    expect((await del(bob, anns['private'] as Created)).statusCode).toBe(404);
  });

  it('restricts the ACL endpoints to holders of share', async () => {
    const pub = anns['public'] as Created;
    expect(
      (await ctx.as(bob, { method: 'GET', url: `/x/annotations/${pub.id}/acl` })).statusCode,
    ).toBe(403);
    expect(
      (await ctx.as(null, { method: 'GET', url: `/x/annotations/${pub.id}/acl` })).statusCode,
    ).toBe(401);
    expect(
      (await ctx.as(carol, { method: 'GET', url: `/x/annotations/${anns['private']?.id}/acl` }))
        .statusCode,
    ).toBe(404);
    const own = await ctx.as(alice, { method: 'GET', url: `/x/annotations/${pub.id}/acl` });
    expect(own.statusCode).toBe(200);
    const entries =
      own.json<{ principal: { id: string; kind: string; name?: string }; permission: string }[]>();
    expect(
      entries.some(
        (e) =>
          e.principal.id === PUBLIC_PRINCIPAL_ID &&
          e.principal.kind === 'public' &&
          e.principal.name === 'public' &&
          e.permission === 'read',
      ),
    ).toBe(true);
    expect(
      entries.some(
        (e) =>
          e.principal.id === aliceId && e.principal.kind === 'user' && e.permission === 'share',
      ),
    ).toBe(true);
    expect(entries.length).toBe(5);
  });

  it('lets everyone be granted read and nothing more', async () => {
    const pub = anns['public'] as Created;
    for (const permission of ['update', 'delete', 'share']) {
      const grant = await ctx.as(alice, {
        method: 'POST',
        url: `/x/annotations/${pub.id}/acl`,
        payload: { principal: PUBLIC_PRINCIPAL_ID, permission },
      });
      expect(grant.statusCode, permission).toBe(422);
    }
    const replaced = await ctx.as(alice, {
      method: 'PUT',
      url: `/x/annotations/${pub.id}/acl`,
      payload: [{ principal: AUTHENTICATED_PRINCIPAL_ID, permission: 'update' }],
    });
    expect(replaced.statusCode).toBe(422);
    const readOnly = await ctx.as(alice, {
      method: 'POST',
      url: `/x/annotations/${pub.id}/acl`,
      payload: { principal: AUTHENTICATED_PRINCIPAL_ID, permission: 'read' },
    });
    expect(readOnly.statusCode).toBe(201);
  });

  it('keeps the creator in control through replace and revoke', async () => {
    const pub = anns['public'] as Created;
    const replaced = await ctx.as(alice, {
      method: 'PUT',
      url: `/x/annotations/${pub.id}/acl`,
      payload: [
        { principal: bobId, permission: 'read' },
        { principal: bobId, permission: 'read' },
        { principal: curators, permission: 'update' },
      ],
    });
    expect(replaced.statusCode).toBe(200);
    const entries = replaced.json<{ principal: { id: string }; permission: string }[]>();
    expect(
      entries
        .filter((e) => e.principal.id === aliceId)
        .map((e) => e.permission)
        .sort(),
    ).toEqual(['delete', 'read', 'share', 'update']);
    expect(entries.filter((e) => e.principal.id === bobId)).toHaveLength(1);
    expect(entries.some((e) => e.principal.id === PUBLIC_PRINCIPAL_ID)).toBe(false);
    expect(await visible(null, pub)).toBe(404);
    expect(await visible(bob, pub)).toBe(200);

    const revokeSelf = await ctx.as(alice, {
      method: 'DELETE',
      url: `/x/annotations/${pub.id}/acl/${aliceId}/read`,
    });
    expect(revokeSelf.statusCode).toBe(403);
    const revoke = await ctx.as(alice, {
      method: 'DELETE',
      url: `/x/annotations/${pub.id}/acl/${bobId}/read`,
    });
    expect(revoke.statusCode).toBe(204);
    expect(await visible(bob, pub)).toBe(404);

    const unknown = await ctx.as(alice, {
      method: 'POST',
      url: `/x/annotations/${pub.id}/acl`,
      payload: { principal: '00000000-0000-0000-0000-00000000dead', permission: 'read' },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('answers 410 to readers and 404 to others after deletion', async () => {
    const shared = anns['authenticated'] as Created;
    const res = await ctx.as(alice, {
      method: 'DELETE',
      url: `/annotations/${shared.id}`,
      headers: { 'if-match': '*' },
    });
    expect(res.statusCode).toBe(204);
    expect(await visible(bob, shared)).toBe(410);
    expect(await visible(null, shared)).toBe(404);
    expect(await searchIds(bob, `/x/search?uri=${encodeURIComponent(PAGE)}`)).not.toContain(
      shared.iri,
    );
  });
});
