import type { FastifyRequest } from 'fastify';
import { sql, type Transaction } from 'kysely';
import type { components } from '@curanno/api-client';
import { requireUser } from '../auth/plugin.js';
import type { UserCaller } from '../auth/caller.js';
import type { Database, GroupRole } from '../db/index.js';
import { isoDate } from '../annotations/serialize.js';
import { conflict, forbidden, notFound } from '../problems.js';
import { isUniqueViolation, type AppContext, type Handlers } from './context.js';

type Group = components['schemas']['Group'];
type GroupInput = components['schemas']['GroupInput'];
type Membership = components['schemas']['Membership'];

interface PageQuery {
  q?: string;
  limit: number;
  offset: number;
}

const like = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function groupHandlers(ctx: AppContext): Handlers {
  const { db } = ctx;

  function groupQuery(caller: UserCaller) {
    return db.selectFrom('groups').select((eb) => [
      'groups.principal_id as id',
      'groups.name',
      'groups.description',
      'groups.created_at',
      'groups.updated_at',
      eb
        .selectFrom('group_memberships')
        .select((e) => e.fn.countAll<string>().as('n'))
        .whereRef('group_memberships.group_id', '=', 'groups.principal_id')
        .as('member_count'),
      eb
        .selectFrom('group_memberships')
        .select('group_memberships.role')
        .whereRef('group_memberships.group_id', '=', 'groups.principal_id')
        .where('group_memberships.user_id', '=', caller.userId)
        .as('role'),
    ]);
  }

  type GroupRow = Awaited<ReturnType<ReturnType<typeof groupQuery>['execute']>>[number];

  const toGroup = (row: GroupRow): Group => ({
    id: row.id,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    created: isoDate(row.created_at),
    modified: isoDate(row.updated_at),
    memberCount: Number(row.member_count ?? 0),
    ...(row.role ? { role: row.role } : {}),
  });

  /** The group, when the caller may see it: members and platform administrators. */
  async function loadVisible(request: FastifyRequest) {
    const caller = requireUser(request);
    const { id } = request.params as { id: string };
    const row = await groupQuery(caller).where('groups.principal_id', '=', id).executeTakeFirst();
    if (!row || (!caller.isAdmin && row.role === null)) throw notFound(`no group ${id}`);
    return { caller, group: row };
  }

  async function loadManaged(request: FastifyRequest) {
    const result = await loadVisible(request);
    if (!result.caller.isAdmin && result.group.role !== 'admin') {
      throw forbidden('group administrators only');
    }
    return result;
  }

  /**
   * The member's current role in the group, after taking a lock on the
   * group's row so that changes to its memberships are made one at a time.
   * With `leavingAdmin`, a change that ends the member's administration,
   * fails with 409 when they are the group's last administrator.
   */
  async function lockMembership(
    trx: Transaction<Database>,
    groupId: string,
    userId: string,
    leavingAdmin: boolean,
  ): Promise<GroupRole | undefined> {
    await trx
      .selectFrom('groups')
      .select('principal_id')
      .where('principal_id', '=', groupId)
      .forUpdate()
      .execute();
    const membership = await trx
      .selectFrom('group_memberships')
      .select('role')
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (leavingAdmin && membership?.role === 'admin') {
      const admins = await trx
        .selectFrom('group_memberships')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('group_id', '=', groupId)
        .where('role', '=', 'admin')
        .executeTakeFirstOrThrow();
      if (Number(admins.n) <= 1) throw conflict('a group keeps at least one administrator');
    }
    return membership?.role;
  }

  return {
    async listGroups(request) {
      const caller = requireUser(request);
      const { q, limit, offset } = request.query as PageQuery;
      let base = groupQuery(caller);
      if (!caller.isAdmin) {
        base = base.where((eb) =>
          eb.exists(
            eb
              .selectFrom('group_memberships')
              .select('group_memberships.group_id')
              .whereRef('group_memberships.group_id', '=', 'groups.principal_id')
              .where('group_memberships.user_id', '=', caller.userId),
          ),
        );
      }
      if (q) base = base.where('groups.name', 'ilike', like(q));
      const total = await base
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      const rows = await base.orderBy('groups.name').limit(limit).offset(offset).execute();
      return { total: Number(total.n), items: rows.map(toGroup) };
    },

    async createGroup(request, reply) {
      const caller = requireUser(request);
      const input = request.body as GroupInput;
      const id = await db.transaction().execute(async (trx) => {
        const principal = await trx
          .insertInto('principals')
          .values({ kind: 'group' })
          .returning('id')
          .executeTakeFirstOrThrow();
        try {
          await trx
            .insertInto('groups')
            .values({
              principal_id: principal.id,
              name: input.name,
              description: input.description ?? null,
              created_by: caller.userId,
            })
            .execute();
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict(`a group named ${input.name} exists`);
          throw err;
        }
        await trx
          .insertInto('group_memberships')
          .values({
            group_id: principal.id,
            user_id: caller.userId,
            role: 'admin',
            added_by: caller.userId,
          })
          .execute();
        return principal.id;
      });
      const row = await groupQuery(caller)
        .where('groups.principal_id', '=', id)
        .executeTakeFirstOrThrow();
      reply.code(201);
      return toGroup(row);
    },

    async getGroup(request) {
      const { group } = await loadVisible(request);
      return toGroup(group);
    },

    async updateGroup(request) {
      const { caller, group } = await loadManaged(request);
      const input = request.body as GroupInput;
      try {
        await db
          .updateTable('groups')
          .set({
            name: input.name,
            description: input.description ?? null,
            updated_at: sql`now()`,
          })
          .where('principal_id', '=', group.id)
          .execute();
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`a group named ${input.name} exists`);
        throw err;
      }
      const row = await groupQuery(caller)
        .where('groups.principal_id', '=', group.id)
        .executeTakeFirstOrThrow();
      return toGroup(row);
    },

    async deleteGroup(request, reply) {
      const { group } = await loadManaged(request);
      // The principal row owns the group, its memberships and its ACL rows.
      await db.deleteFrom('principals').where('id', '=', group.id).execute();
      return reply.code(204).send();
    },

    async listMembers(request) {
      const caller = requireUser(request);
      const { id } = request.params as { id: string };
      const row = await groupQuery(caller).where('groups.principal_id', '=', id).executeTakeFirst();
      if (!row) throw notFound(`no group ${id}`);
      if (!caller.isAdmin && row.role === null) throw forbidden('members only');
      const members = await db
        .selectFrom('group_memberships')
        .innerJoin('users', 'users.principal_id', 'group_memberships.user_id')
        .select([
          'users.principal_id',
          'users.display_name',
          'group_memberships.role',
          'group_memberships.added_at',
        ])
        .where('group_memberships.group_id', '=', id)
        .orderBy('users.display_name')
        .orderBy('users.principal_id')
        .execute();
      return members.map((m): Membership => ({
        user: {
          id: m.principal_id,
          ...(m.display_name !== null ? { displayName: m.display_name } : {}),
        },
        role: m.role,
        addedAt: isoDate(m.added_at),
      }));
    },

    async setMember(request, reply) {
      const { caller, group } = await loadManaged(request);
      const { userId } = request.params as { userId: string };
      const role = (request.body as { role?: GroupRole } | undefined)?.role ?? 'member';
      const user = await db
        .selectFrom('users')
        .select('principal_id')
        .where('principal_id', '=', userId)
        .executeTakeFirst();
      if (!user) throw notFound(`no user ${userId}`);
      await db.transaction().execute(async (trx) => {
        await lockMembership(trx, group.id, userId, role !== 'admin');
        await trx
          .insertInto('group_memberships')
          .values({ group_id: group.id, user_id: userId, role, added_by: caller.userId })
          .onConflict((oc) => oc.columns(['group_id', 'user_id']).doUpdateSet({ role }))
          .execute();
      });
      return reply.code(204).send();
    },

    async removeMember(request, reply) {
      const caller = requireUser(request);
      const { id, userId } = request.params as { id: string; userId: string };
      const row = await groupQuery(caller).where('groups.principal_id', '=', id).executeTakeFirst();
      if (!row || (!caller.isAdmin && row.role === null)) throw notFound(`no group ${id}`);
      if (!caller.isAdmin && row.role !== 'admin' && caller.userId !== userId) {
        throw forbidden('group administrators only, or the member themself');
      }
      await db.transaction().execute(async (trx) => {
        const role = await lockMembership(trx, id, userId, true);
        if (!role) throw notFound(`${userId} is not a member`);
        await trx
          .deleteFrom('group_memberships')
          .where('group_id', '=', id)
          .where('user_id', '=', userId)
          .execute();
      });
      return reply.code(204).send();
    },
  };
}
