/**
 * Annotation persistence. Every query that returns annotations carries the
 * ACL filter for the caller's principals (ADR 0006); nothing here reads an
 * annotation without it. Writes record an `annotation_events` row in the
 * same transaction so that the event stream sees exactly what was committed.
 */
import {
  sql,
  type Kysely,
  type SelectQueryBuilder,
  type UpdateQueryBuilder,
  type UpdateResult,
} from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { AnchoringState, Permission } from '@curanno/model';
import type { Caller, UserCaller } from '../auth/caller.js';
import type { Database } from '../db/index.js';
import { documentForSource } from '../documents/service.js';
import { preconditionFailed, unprocessable } from '../problems.js';
import { stableJson, type ParsedAnnotation } from './input.js';
import { annotationIdFromIri, type AnnotationRecord } from './serialize.js';

export interface SearchFilters {
  documentId?: string | undefined;
  text?: string | undefined;
  motivation?: string | undefined;
  purpose?: string | undefined;
  profile?: string | undefined;
  creator?: string | undefined;
  state?: AnchoringState | undefined;
  parent?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
}

export interface ListOptions extends SearchFilters {
  sort?: 'created' | 'modified' | undefined;
  order?: 'asc' | 'desc' | undefined;
  limit: number;
  offset: number;
}

export interface ListResult {
  total: number;
  modified: Date | null;
  items: AnnotationRecord[];
}

type AnnotationQuery = SelectQueryBuilder<Database, 'annotations', object>;

const principalArray = (ids: string[]) => sql`${ids}::uuid[]`;

/** `true` when one of the principals holds `permission` on the annotation row aliased `annotations`. */
export function hasPermission(ids: string[], permission: Permission) {
  return sql<boolean>`exists (select 1 from acl where acl.annotation_id = annotations.id and acl.permission = ${permission} and acl.principal_id = any(${principalArray(ids)}))`;
}

export class AnnotationStore {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly publicUrl: string,
  ) {}

  /** Annotations the caller may read, deleted ones included; callers decide how to answer for those. */
  private visible(db: Kysely<Database>, caller: Caller): AnnotationQuery {
    return db.selectFrom('annotations').where(hasPermission(caller.principalIds, 'read'));
  }

  private withRecord(query: AnnotationQuery, caller: Caller) {
    return query
      .leftJoin('users', 'users.principal_id', 'annotations.created_by')
      .select((eb) => [
        'annotations.id',
        'annotations.document_id',
        'annotations.parent_id',
        'annotations.created_by',
        'users.display_name as creator_name',
        'annotations.created_at',
        'annotations.updated_at',
        'annotations.version',
        'annotations.motivation',
        'annotations.data',
        'annotations.deleted_at',
        jsonArrayFrom(
          eb
            .selectFrom('bodies')
            .select(['bodies.position', 'bodies.body'])
            .whereRef('bodies.annotation_id', '=', 'annotations.id')
            .orderBy('bodies.position'),
        ).as('bodies'),
        jsonArrayFrom(
          eb
            .selectFrom('targets')
            .select([
              'targets.position',
              'targets.source',
              'targets.selectors',
              'targets.anchoring_state',
              'targets.repair',
              'targets.data',
            ])
            .whereRef('targets.annotation_id', '=', 'annotations.id')
            .orderBy('targets.position'),
        ).as('targets'),
        sql<
          Permission[]
        >`coalesce((select array_agg(distinct acl.permission order by acl.permission) from acl where acl.annotation_id = annotations.id and acl.principal_id = any(${principalArray(caller.principalIds)})), '{}')`.as(
          'permissions',
        ),
      ]);
  }

  async get(id: string, caller: Caller): Promise<AnnotationRecord | undefined> {
    const row = await this.withRecord(this.visible(this.db, caller), caller)
      .where('annotations.id', '=', id)
      .executeTakeFirst();
    return row;
  }

  /**
   * The queries behind `list`. `page` computes the filtered set once, in a
   * materialized CTE, and returns its size, its latest modification and the
   * ids of the requested page in order; `records` loads those annotations.
   * Counting and paging in two statements paid the ACL join twice, and the
   * paging statement built every row before the offset only to discard it
   * (docs/performance.md).
   */
  listQueries(caller: Caller, options: ListOptions) {
    const matched = applyFilters(
      this.visible(this.db, caller).where('annotations.deleted_at', 'is', null),
      options,
    ).select(['annotations.id', 'annotations.created_at', 'annotations.updated_at']);
    const column = options.sort === 'modified' ? 'updated_at' : 'created_at';
    const order = options.order ?? 'desc';
    const page = this.db
      .with(
        (cte) => cte('matched').materialized(),
        () => matched,
      )
      .selectNoFrom((eb) => [
        eb
          .selectFrom('matched')
          .select((e) => e.fn.countAll<string>().as('total'))
          .as('total'),
        eb
          .selectFrom('matched')
          .select((e) => e.fn.max('matched.updated_at').as('modified'))
          .as('modified'),
        jsonArrayFrom(
          eb
            .selectFrom('matched')
            .select('matched.id')
            .orderBy(column, order)
            .orderBy('matched.id', order)
            .limit(options.limit)
            .offset(options.offset),
        ).as('ids'),
      ]);
    const records = (ids: string[]) =>
      this.byIds(ids, caller).where('annotations.deleted_at', 'is', null);
    return { page, records };
  }

  /** The annotations among `ids` the caller may read, deleted ones included, by id. */
  async getMany(ids: string[], caller: Caller): Promise<Map<string, AnnotationRecord>> {
    if (ids.length === 0) return new Map();
    const rows = await this.byIds(ids, caller).execute();
    return new Map(rows.map((row) => [row.id, row]));
  }

  private byIds(ids: string[], caller: Caller) {
    return this.withRecord(this.visible(this.db, caller), caller).where(
      'annotations.id',
      'in',
      ids,
    );
  }

  /** Readable, undeleted annotations matching the filters, with the total and the latest modification. */
  async list(caller: Caller, options: ListOptions): Promise<ListResult> {
    const queries = this.listQueries(caller, options);
    const page = await queries.page.executeTakeFirstOrThrow();
    const ids = page.ids.map((row) => row.id);
    const records = ids.length === 0 ? [] : await queries.records(ids).execute();
    const byId = new Map(records.map((record) => [record.id, record]));
    return {
      total: Number(page.total ?? 0),
      modified: page.modified ?? null,
      items: ids.flatMap((id) => byId.get(id) ?? []),
    };
  }

  async create(parsed: ParsedAnnotation, caller: UserCaller): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const { parentId, documentIds } = await this.resolveReferences(trx, parsed, caller);
      let documentId = documentIds.find((d) => d !== undefined) ?? null;
      if (documentId === null && parentId) {
        const parent = await trx
          .selectFrom('annotations')
          .select('document_id')
          .where('id', '=', parentId)
          .executeTakeFirst();
        documentId = parent?.document_id ?? null;
      }
      const annotation = await trx
        .insertInto('annotations')
        .values({
          document_id: documentId,
          parent_id: parentId,
          created_by: caller.userId,
          motivation: parsed.motivation,
          data: JSON.stringify(parsed.data),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.writeParts(trx, annotation.id, parsed, documentIds);
      await trx
        .insertInto('acl')
        .values(
          (['read', 'update', 'delete', 'share'] as Permission[]).map((permission) => ({
            annotation_id: annotation.id,
            principal_id: caller.userId,
            permission,
            granted_by: caller.userId,
          })),
        )
        .execute();
      await trx
        .insertInto('annotation_events')
        .values({
          annotation_id: annotation.id,
          document_id: documentId,
          kind: 'created',
          actor_id: caller.userId,
        })
        .execute();
      return annotation.id;
    });
  }

  /**
   * Replace an annotation's content. The caller has already been checked
   * for the permission; `expected` is the version `If-Match` named (`null`
   * for `*`), checked again by the write itself so that a concurrent write
   * between the read and this one fails with 412 instead of being lost.
   */
  async replace(
    current: AnnotationRecord,
    parsed: ParsedAnnotation,
    caller: UserCaller,
    expected: number | null,
  ): Promise<void> {
    for (const target of parsed.targets) {
      const before = current.targets.find((t) => t.position === parsed.targets.indexOf(target));
      if (
        before &&
        before.selectors !== null &&
        stableJson(before.selectors) !== stableJson(target.selectors)
      ) {
        throw unprocessable(
          `/target/${before.position}/selector is immutable (ADR 0010); record a repair in anchoring.repair instead`,
        );
      }
    }
    await this.db.transaction().execute(async (trx) => {
      const { parentId, documentIds } = await this.resolveReferences(trx, parsed, caller);
      const documentId = documentIds.find((d) => d !== undefined) ?? current.document_id;
      await this.claimVersion(
        trx
          .updateTable('annotations')
          .set({
            document_id: documentId,
            parent_id: parentId,
            motivation: parsed.motivation,
            data: JSON.stringify(parsed.data),
            version: sql`version + 1`,
            updated_at: sql`now()`,
          })
          .where('id', '=', current.id),
        expected,
      );
      await trx.deleteFrom('bodies').where('annotation_id', '=', current.id).execute();
      await trx.deleteFrom('targets').where('annotation_id', '=', current.id).execute();
      await this.writeParts(trx, current.id, parsed, documentIds);
      await trx
        .insertInto('annotation_events')
        .values({
          annotation_id: current.id,
          document_id: documentId,
          kind: 'updated',
          actor_id: caller.userId,
        })
        .execute();
    });
  }

  /** Soft-delete an annotation; `expected` as for `replace`. */
  async softDelete(
    current: AnnotationRecord,
    caller: UserCaller,
    expected: number | null,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.claimVersion(
        trx
          .updateTable('annotations')
          .set({ deleted_at: sql`now()`, updated_at: sql`now()`, version: sql`version + 1` })
          .where('id', '=', current.id),
        expected,
      );
      await trx
        .insertInto('annotation_events')
        .values({
          annotation_id: current.id,
          document_id: current.document_id,
          kind: 'deleted',
          actor_id: caller.userId,
        })
        .execute();
    });
  }

  /** Whether the caller may currently read the annotation (deleted or not). */
  async canRead(id: string, caller: Caller): Promise<boolean> {
    const row = await this.visible(this.db, caller)
      .select('annotations.id')
      .where('annotations.id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  /**
   * Run the update of the annotation row that a write starts with, only if
   * the annotation is not deleted and, unless `expected` is null, is still
   * at that version. The row stays locked until the transaction ends, so of
   * two writes that read the same version one fails here with 412.
   */
  private async claimVersion(
    update: UpdateQueryBuilder<Database, 'annotations', 'annotations', UpdateResult>,
    expected: number | null,
  ): Promise<void> {
    let query = update.where('deleted_at', 'is', null);
    if (expected !== null) query = query.where('version', '=', expected);
    const result = await query.executeTakeFirst();
    if (result.numUpdatedRows === 0n) throw preconditionFailed();
  }

  private async resolveReferences(
    trx: Kysely<Database>,
    parsed: ParsedAnnotation,
    caller: UserCaller,
  ): Promise<{ parentId: string | null; documentIds: (string | undefined)[] }> {
    let parentId: string | null = null;
    const documentIds: (string | undefined)[] = [];
    for (const [i, target] of parsed.targets.entries()) {
      const annotationId = annotationIdFromIri(this.publicUrl, target.source);
      if (annotationId !== undefined) {
        const parent = await this.visible(trx, caller)
          .select('annotations.id')
          .where('annotations.id', '=', annotationId)
          .where('annotations.deleted_at', 'is', null)
          .executeTakeFirst();
        if (!parent) throw unprocessable(`/target/${i}: no such annotation ${target.source}`);
        parentId ??= annotationId;
        documentIds.push(undefined);
      } else {
        documentIds.push(await documentForSource(trx, target.source, caller.userId));
      }
    }
    return { parentId, documentIds };
  }

  private async writeParts(
    trx: Kysely<Database>,
    annotationId: string,
    parsed: ParsedAnnotation,
    documentIds: (string | undefined)[],
  ): Promise<void> {
    if (parsed.targets.length > 0) {
      await trx
        .insertInto('targets')
        .values(
          parsed.targets.map((t, position) => ({
            annotation_id: annotationId,
            position,
            source: t.source,
            document_id: documentIds[position] ?? null,
            selectors: t.selectors === null ? null : JSON.stringify(t.selectors),
            anchoring_state: t.anchoringState,
            repair: t.repair === null ? null : JSON.stringify(t.repair),
            data: JSON.stringify(t.data),
          })),
        )
        .execute();
    }
    if (parsed.bodies.length > 0) {
      await trx
        .insertInto('bodies')
        .values(
          parsed.bodies.map((body, position) => ({
            annotation_id: annotationId,
            position,
            body: JSON.stringify(body),
          })),
        )
        .execute();
    }
  }
}

function applyFilters(query: AnnotationQuery, f: SearchFilters): AnnotationQuery {
  let q = query;
  if (f.documentId !== undefined) q = q.where('annotations.document_id', '=', f.documentId);
  if (f.creator !== undefined) q = q.where('annotations.created_by', '=', f.creator);
  if (f.parent !== undefined) q = q.where('annotations.parent_id', '=', f.parent);
  if (f.motivation !== undefined) {
    q = q.where(sql<boolean>`${f.motivation} = any(annotations.motivation)`);
  }
  if (f.since !== undefined) q = q.where('annotations.updated_at', '>=', new Date(f.since));
  if (f.until !== undefined) q = q.where('annotations.updated_at', '<', new Date(f.until));
  if (f.state !== undefined) {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom('targets')
          .select('targets.id')
          .whereRef('targets.annotation_id', '=', 'annotations.id')
          .where('targets.anchoring_state', '=', f.state as AnchoringState),
      ),
    );
  }
  if (f.purpose !== undefined || f.profile !== undefined) {
    q = q.where((eb) => {
      let bodies = eb
        .selectFrom('bodies')
        .select('bodies.id')
        .whereRef('bodies.annotation_id', '=', 'annotations.id');
      if (f.purpose !== undefined) {
        bodies = bodies.where(
          sql<boolean>`bodies.body -> 'purpose' @> to_jsonb(${f.purpose}::text)`,
        );
      }
      if (f.profile !== undefined) bodies = bodies.where('bodies.profile', '=', f.profile);
      return eb.exists(bodies);
    });
  }
  if (f.text !== undefined && f.text.trim() !== '') {
    const tsquery = sql`websearch_to_tsquery('english', ${f.text})`;
    // The matching ids come from the two GIN indexes as one set. Written as
    // an OR of correlated EXISTS clauses the condition was evaluated per
    // annotation and used neither index (docs/performance.md).
    q = q.where('annotations.id', 'in', (eb) =>
      eb
        .selectFrom('bodies')
        .select('bodies.annotation_id')
        .where(sql<boolean>`bodies.text_search @@ ${tsquery}`)
        .union(
          eb
            .selectFrom('targets')
            .select('targets.annotation_id')
            .where(sql<boolean>`targets.quote_search @@ ${tsquery}`),
        ),
    );
  }
  return q;
}
