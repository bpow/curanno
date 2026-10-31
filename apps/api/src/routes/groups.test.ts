/**
 * Group memberships through the API: a group always keeps at least one
 * administrator, whether a membership is removed or its role is changed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alice,
  bob,
  carol,
  createTestContext,
  databaseUrl,
  type TestContext,
  type TestUser,
} from '../test/harness.js';

describe.skipIf(!databaseUrl)('group memberships', () => {
  let ctx: TestContext;
  const ids = new Map<TestUser, string>();
  beforeAll(async () => {
    ctx = await createTestContext();
    for (const user of [alice, bob, carol]) {
      const me = await ctx.as(user, { method: 'GET', url: '/x/me' });
      ids.set(user, me.json<{ id: string }>().id);
    }
  });
  afterAll(() => ctx.close());

  async function groupOf(admin: TestUser, name: string): Promise<string> {
    const res = await ctx.as(admin, { method: 'POST', url: '/x/groups', payload: { name } });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
  }
  const setRole = (as: TestUser, group: string, user: TestUser, role: 'admin' | 'member') =>
    ctx.as(as, {
      method: 'PUT',
      url: `/x/groups/${group}/members/${ids.get(user)}`,
      payload: { role },
    });
  const remove = (as: TestUser, group: string, user: TestUser) =>
    ctx.as(as, { method: 'DELETE', url: `/x/groups/${group}/members/${ids.get(user)}` });
  async function admins(group: string): Promise<number> {
    const res = await ctx.as(alice, { method: 'GET', url: `/x/groups/${group}/members` });
    return res.json<{ role: string }[]>().filter((m) => m.role === 'admin').length;
  }

  it('refuses to demote or remove the last administrator', async () => {
    const group = await groupOf(alice, 'Solo');
    expect((await setRole(alice, group, alice, 'member')).statusCode).toBe(409);
    expect((await remove(alice, group, alice)).statusCode).toBe(409);
    expect((await setRole(alice, group, alice, 'admin')).statusCode).toBe(204);
    expect(await admins(group)).toBe(1);
  });

  it('allows a demotion while another administrator remains', async () => {
    const group = await groupOf(alice, 'Pair');
    expect((await setRole(alice, group, bob, 'admin')).statusCode).toBe(204);
    expect((await setRole(alice, group, alice, 'member')).statusCode).toBe(204);
    expect(await admins(group)).toBe(1);
  });

  it('keeps an administrator through concurrent demotions and removals', async () => {
    const group = await groupOf(alice, 'Race');
    expect((await setRole(alice, group, bob, 'admin')).statusCode).toBe(204);
    expect((await setRole(alice, group, carol, 'admin')).statusCode).toBe(204);
    const codes = (
      await Promise.all([
        setRole(alice, group, alice, 'member'),
        remove(bob, group, bob),
        setRole(carol, group, carol, 'member'),
      ])
    )
      .map((r) => r.statusCode)
      .sort();
    expect(codes).toEqual([204, 204, 409]);
    expect(await admins(group)).toBe(1);
  });
});
