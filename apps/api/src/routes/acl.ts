/**
 * Per-annotation access control (ADR 0006). Every operation needs the
 * `share` permission on the annotation; the creator's four permissions are
 * kept whatever the request says.
 */
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { components } from '@curanno/api-client';
import { PERMISSIONS, type Permission } from '@curanno/model';
import { requireUser } from '../auth/plugin.js';
import { AUTHENTICATED_PRINCIPAL_ID, PUBLIC_PRINCIPAL_ID, type Database } from '../db/index.js';
import { isoDate } from '../annotations/serialize.js';
import { badRequest, forbidden, notFound, unprocessable } from '../problems.js';
import type { AppContext, Handlers } from './context.js';

type AclGrant = components['schemas']['AclGrant'];
type AclEntry = components['schemas']['AclEntry'];

export async function listAcl(db: Kysely<Database>, annotationId: string): Promise<AclEntry[]> {
  const rows = await db
    .selectFrom('acl')
    .innerJoin('principals', 'principals.id', 'acl.principal_id')
    .leftJoin('users', 'users.principal_id', 'acl.principal_id')
    .leftJoin('groups', 'groups.principal_id', 'acl.principal_id')
    .select([
      'acl.principal_id',
      'principals.kind',
      'users.display_name',
      'groups.name as group_name',
      'acl.permission',
      'acl.granted_by',
      'acl.granted_at',
    ])
    .where('acl.annotation_id', '=', annotationId)
    .orderBy('principals.kind')
    .orderBy('acl.principal_id')
    .orderBy('acl.permission')
    .execute();
  return rows.map((row) => {
    const name =
      row.kind === 'user' ? row.display_name : row.kind === 'group' ? row.group_name : row.kind;
    return {
      principal: { id: row.principal_id, kind: row.kind, ...(name ? { name } : {}) },
      permission: row.permission,
      ...(row.granted_by !== null ? { grantedBy: row.granted_by } : {}),
      grantedAt: isoDate(row.granted_at),
    };
  });
}

export function aclHandlers(ctx: AppContext): Handlers {
  const { db, store } = ctx;

  async function loadShareable(request: FastifyRequest) {
    const caller = requireUser(request);
    const { id } = request.params as { id: string };
    const record = await store.get(id, caller);
    if (!record || record.deleted_at !== null) throw notFound();
    if (!record.permissions.includes('share')) throw forbidden('the share permission is required');
    return { caller, record };
  }

  /** `public` and `authenticated` may be given `read` and nothing else: anyone would hold it. */
  function checkPseudoGrants(grants: { principal: string; permission: Permission }[]): void {
    for (const g of grants) {
      if (
        (g.principal === PUBLIC_PRINCIPAL_ID || g.principal === AUTHENTICATED_PRINCIPAL_ID) &&
        g.permission !== 'read'
      ) {
        throw unprocessable(`${g.permission} cannot be granted to everyone; only read can`);
      }
    }
  }

  async function checkPrincipals(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await db.selectFrom('principals').select('id').where('id', 'in', ids).execute();
    const known = new Set(found.map((p) => p.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) throw badRequest(`unknown principal ${missing.join(', ')}`);
  }

  async function recordChange(
    trx: Kysely<Database>,
    annotationId: string,
    documentId: string | null,
    actorId: string,
  ) {
    await trx
      .insertInto('annotation_events')
      .values({
        annotation_id: annotationId,
        document_id: documentId,
        kind: 'updated',
        actor_id: actorId,
      })
      .execute();
  }

  return {
    async getAcl(request) {
      const { record } = await loadShareable(request);
      return listAcl(db, record.id);
    },

    async replaceAcl(request) {
      const { caller, record } = await loadShareable(request);
      const grants = request.body as AclGrant[];
      checkPseudoGrants(grants);
      await checkPrincipals([...new Set(grants.map((g) => g.principal))]);
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('acl')
          .where('annotation_id', '=', record.id)
          .where('principal_id', '<>', record.created_by)
          .execute();
        const rows = new Map<string, { principal_id: string; permission: Permission }>();
        for (const g of grants) {
          if (g.principal === record.created_by) continue;
          rows.set(`${g.principal}/${g.permission}`, {
            principal_id: g.principal,
            permission: g.permission,
          });
        }
        if (rows.size > 0) {
          await trx
            .insertInto('acl')
            .values(
              [...rows.values()].map((r) => ({
                ...r,
                annotation_id: record.id,
                granted_by: caller.userId,
              })),
            )
            .execute();
        }
        await trx
          .insertInto('acl')
          .values(
            PERMISSIONS.map((permission) => ({
              annotation_id: record.id,
              principal_id: record.created_by,
              permission,
              granted_by: record.created_by,
            })),
          )
          .onConflict((oc) => oc.doNothing())
          .execute();
        await recordChange(trx, record.id, record.document_id, caller.userId);
      });
      return listAcl(db, record.id);
    },

    async grantPermission(request, reply) {
      const { caller, record } = await loadShareable(request);
      const grant = request.body as AclGrant;
      checkPseudoGrants([grant]);
      await checkPrincipals([grant.principal]);
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('acl')
          .values({
            annotation_id: record.id,
            principal_id: grant.principal,
            permission: grant.permission,
            granted_by: caller.userId,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await recordChange(trx, record.id, record.document_id, caller.userId);
      });
      const entries = await listAcl(db, record.id);
      const entry = entries.find(
        (e) => e.principal.id === grant.principal && e.permission === grant.permission,
      );
      reply.code(201);
      return entry;
    },

    async revokePermission(request, reply) {
      const { caller, record } = await loadShareable(request);
      const { principalId, permission } = request.params as {
        principalId: string;
        permission: Permission;
      };
      if (principalId === record.created_by) {
        throw forbidden("the creator's permissions cannot be revoked");
      }
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('acl')
          .where('annotation_id', '=', record.id)
          .where('principal_id', '=', principalId)
          .where('permission', '=', permission)
          .execute();
        await recordChange(trx, record.id, record.document_id, caller.userId);
      });
      return reply.code(204).send();
    },
  };
}
