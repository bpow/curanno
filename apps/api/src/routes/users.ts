import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { components } from '@curanno/api-client';
import { requireAdmin, requireUser } from '../auth/plugin.js';
import type { UserCaller } from '../auth/caller.js';
import { AUTHENTICATED_PRINCIPAL_ID, PUBLIC_PRINCIPAL_ID, type Database } from '../db/index.js';
import { isoDate } from '../annotations/serialize.js';
import { conflict, notFound } from '../problems.js';
import { revokeSessions } from '../auth/embedded/adapter.js';
import type { AppContext, Handlers } from './context.js';

type User = components['schemas']['User'];
type UserPatch = components['schemas']['UserPatch'];
type PrincipalRef = components['schemas']['PrincipalRef'];

interface PageQuery {
  q?: string;
  limit: number;
  offset: number;
}

export async function loadUsers(
  db: Kysely<Database>,
  ids: string[],
  viewer: UserCaller,
): Promise<User[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom('users')
    .select(['principal_id', 'display_name', 'email', 'is_admin', 'status', 'created_at'])
    .where('principal_id', 'in', ids)
    .execute();
  const memberships = await db
    .selectFrom('group_memberships')
    .innerJoin('groups', 'groups.principal_id', 'group_memberships.group_id')
    .select(['group_memberships.user_id', 'groups.principal_id as id', 'groups.name'])
    .where('group_memberships.user_id', 'in', ids)
    .orderBy('groups.name')
    .execute();
  const byId = new Map(rows.map((r) => [r.principal_id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    // Email and memberships are the user's own business and the administrators'.
    const privileged = viewer.isAdmin || viewer.userId === id;
    return [
      {
        id: row.principal_id,
        ...(row.display_name !== null ? { displayName: row.display_name } : {}),
        ...(privileged && row.email !== null ? { email: row.email } : {}),
        isAdmin: row.is_admin,
        status: row.status,
        created: isoDate(row.created_at),
        groups: privileged
          ? memberships.filter((m) => m.user_id === id).map((m) => ({ id: m.id, name: m.name }))
          : [],
      },
    ];
  });
}

async function loadUser(db: Kysely<Database>, id: string, viewer: UserCaller): Promise<User> {
  const [user] = await loadUsers(db, [id], viewer);
  if (!user) throw notFound(`no user ${id}`);
  return user;
}

/** A viewer who sees only their own record. */
const ownView = {
  kind: 'user' as const,
  displayName: undefined,
  isAdmin: false,
  status: 'active' as const,
  principalIds: [] as string[],
};

const like = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function userHandlers(ctx: AppContext): Handlers {
  const { db } = ctx;
  return {
    async getCurrentUser(request: FastifyRequest) {
      const caller = request.caller;
      if (caller.kind === 'anonymous' && caller.withheld) {
        // Told their status, and nothing they could not see as the public.
        const { userId } = caller.withheld;
        return loadUser(db, userId, { ...ownView, userId });
      }
      const user = requireUser(request);
      return loadUser(db, user.userId, user);
    },

    async listUsers(request) {
      const caller = requireAdmin(request);
      const { q, limit, offset } = request.query as PageQuery;
      let base = db.selectFrom('users');
      if (q) {
        base = base.where((eb) =>
          eb.or([eb('display_name', 'ilike', like(q)), eb('email', 'ilike', like(q))]),
        );
      }
      const total = await base
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      const ids = await base
        .select('principal_id')
        .orderBy('display_name')
        .orderBy('principal_id')
        .limit(limit)
        .offset(offset)
        .execute();
      return {
        total: Number(total.n),
        items: await loadUsers(
          db,
          ids.map((r) => r.principal_id),
          caller,
        ),
      };
    },

    async getUser(request) {
      const caller = requireUser(request);
      const { id } = request.params as { id: string };
      return loadUser(db, id, caller);
    },

    async updateUser(request) {
      const caller = requireAdmin(request);
      const { id } = request.params as { id: string };
      const patch = request.body as UserPatch;
      if (id === caller.userId && patch.status !== undefined && patch.status !== 'active') {
        throw conflict('administrators cannot disable themselves');
      }
      const updated = await db
        .updateTable('users')
        .set({
          ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
          ...(patch.isAdmin !== undefined ? { is_admin: patch.isAdmin } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        })
        .where('principal_id', '=', id)
        .returning('principal_id')
        .executeTakeFirst();
      if (!updated) throw notFound(`no user ${id}`);
      // Disabling takes effect now: the sessions and refresh tokens go (access tokens last at most an hour).
      if (patch.status === 'disabled') await revokeSessions(db, id);
      return loadUser(db, id, caller);
    },

    async searchPrincipals(request) {
      requireUser(request);
      const { q, limit } = request.query as { q?: string; limit: number };
      const needle = (q ?? '').toLowerCase();
      const results: PrincipalRef[] = [];
      for (const pseudo of [
        { id: PUBLIC_PRINCIPAL_ID, kind: 'public' as const, name: 'public' },
        { id: AUTHENTICATED_PRINCIPAL_ID, kind: 'authenticated' as const, name: 'authenticated' },
      ]) {
        if (pseudo.name.includes(needle)) results.push(pseudo);
      }
      let groups = db.selectFrom('groups').select(['principal_id', 'name']).orderBy('name');
      if (q) groups = groups.where('name', 'ilike', like(q));
      for (const g of await groups.limit(limit).execute()) {
        results.push({ id: g.principal_id, kind: 'group', name: g.name });
      }
      // Display names only: matching on email would let anyone list a domain's users.
      let users = db
        .selectFrom('users')
        .select(['principal_id', 'display_name'])
        .where('display_name', 'is not', null)
        .orderBy('display_name');
      if (q) users = users.where('display_name', 'ilike', like(q));
      for (const u of await users.limit(limit).execute()) {
        results.push({
          id: u.principal_id,
          kind: 'user',
          ...(u.display_name ? { name: u.display_name } : {}),
        });
      }
      return results.slice(0, limit);
    },
  };
}
