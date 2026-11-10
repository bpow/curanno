/**
 * The ontology store (docs/ontologies.md): releases an operator imports, and
 * the term search body editors use to suggest terms.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/index.js';
import type { ParsedOntology } from './obographs.js';

export interface OntologyInfo {
  name: string;
  title: string;
  version?: string;
  license?: string;
  homepage?: string;
  terms: number;
  loaded: string;
}

export interface TermMatch {
  id: string;
  label: string;
  /** The synonym that matched, when it was not the label. */
  synonym?: string;
}

export interface TermQuery {
  q: string;
  /** Only this term and its descendants. */
  root?: string | undefined;
  limit: number;
}

const BATCH = 1000;

/** Replace everything stored for `name` with this release, in one transaction. */
export async function importOntology(
  db: Kysely<Database>,
  name: string,
  parsed: ParsedOntology,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const row = {
      title: parsed.title ?? name.toUpperCase(),
      version: parsed.version ?? null,
      license: parsed.license ?? null,
      homepage: parsed.homepage ?? null,
      loaded_at: new Date(),
    };
    await trx
      .insertInto('ontologies')
      .values({ name, ...row })
      .onConflict((oc) => oc.column('name').doUpdateSet(row))
      .execute();
    await trx.deleteFrom('ontology_terms').where('ontology', '=', name).execute();
    for (let i = 0; i < parsed.terms.length; i += BATCH) {
      await trx
        .insertInto('ontology_terms')
        .values(parsed.terms.slice(i, i + BATCH).map((t) => ({ ontology: name, ...t })))
        .execute();
    }
  });
}

export async function listOntologies(db: Kysely<Database>): Promise<OntologyInfo[]> {
  const rows = await db
    .selectFrom('ontologies as o')
    .select((eb) => [
      'o.name',
      'o.title',
      'o.version',
      'o.license',
      'o.homepage',
      'o.loaded_at',
      eb
        .selectFrom('ontology_terms as t')
        .whereRef('t.ontology', '=', 'o.name')
        .select(eb.fn.countAll<string>().as('n'))
        .as('terms'),
    ])
    .orderBy('o.name')
    .execute();
  return rows.map((r) => ({
    name: r.name,
    title: r.title,
    ...(r.version !== null ? { version: r.version } : {}),
    ...(r.license !== null ? { license: r.license } : {}),
    ...(r.homepage !== null ? { homepage: r.homepage } : {}),
    terms: Number(r.terms ?? 0),
    loaded: new Date(r.loaded_at).toISOString(),
  }));
}

export async function hasOntology(db: Kysely<Database>, name: string): Promise<boolean> {
  const row = await db
    .selectFrom('ontologies')
    .select('name')
    .where('name', '=', name)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Terms whose ID equals the query or one of whose names (label or synonym)
 * contains every word of it, best first: ID, whole name, name prefix, word
 * prefix, then anywhere; a label before a synonym, a shorter name before a
 * longer one.
 */
export async function searchTerms(
  db: Kysely<Database>,
  ontology: string,
  query: TermQuery,
): Promise<TermMatch[]> {
  const q = query.q.trim().toLowerCase();
  if (!q) return [];
  const escape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
  const like = escape(q);
  const words = sql.join(
    q.split(/\s+/).map((w) => sql`lower(n.name) like ${'%' + escape(w) + '%'} escape '\\'`),
    sql` and `,
  );
  const root = query.root ?? null;
  const result = await sql<{ id: string; label: string; name: string; is_label: boolean }>`
    with names as (
      select t.id, t.label, n.name, n.ord = 1 as is_label,
        case
          when lower(t.id) = ${q} then 0
          when lower(n.name) = ${q} then 1
          when lower(n.name) like ${like + '%'} escape '\\' then 2
          when lower(n.name) like ${'% ' + like + '%'} escape '\\' then 3
          else 4
        end as rank
      from ontology_terms t
      cross join lateral unnest(array[t.label] || t.synonyms) with ordinality as n(name, ord)
      where t.ontology = ${ontology}
        and (${root}::text is null or t.id = ${root} or ${root} = any(t.ancestors))
        and ((${words}) or lower(t.id) = ${q})
    ),
    best as (
      select distinct on (id) id, label, name, is_label, rank
      from names
      order by id, rank, is_label desc, length(name)
    )
    select id, label, name, is_label from best
    order by rank, is_label desc, length(name), label
    limit ${query.limit}
  `.execute(db);
  return result.rows.map((r) => ({
    id: r.id,
    label: r.label,
    ...(r.is_label ? {} : { synonym: r.name }),
  }));
}
