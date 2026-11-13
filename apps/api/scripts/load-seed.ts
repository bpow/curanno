/**
 * Fills a database with annotation data at the volumes the plan's risk
 * table calls representative, for the load test in docs/performance.md:
 * documents, users, groups with skewed membership, annotations with
 * realistic body text and quotes, ACL rows mixing creator-only,
 * group-shared, authenticated and public grants, and the event rows the
 * SSE replay reads. Everything derives from one seed, so two runs with the
 * same parameters produce the same rows.
 *
 *   DATABASE_URL=postgres://... node --experimental-strip-types scripts/load-seed.ts \
 *     [--annotations 1000000] [--documents 10000] [--users 5000] [--groups 500] \
 *     [--seed 1] [--truncate]
 *
 * The migrations are applied first. The database must hold no annotations
 * unless --truncate is given, which removes every user, group, document and
 * annotation (body profiles stay).
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';
import {
  LOAD_ISSUER,
  TextGenerator,
  Zipf,
  documentUri,
  groupName,
  hashSeed,
  numberArg,
  randomInt,
  rng,
  userSubject,
  uuidFrom,
  type Random,
} from './load-common.ts';

export interface SeedOptions {
  annotations: number;
  documents: number;
  users: number;
  groups: number;
  seed: number;
  /** Remove existing data first instead of refusing to run. */
  truncate: boolean;
  /** Annotations generated and inserted at a time. */
  batchSize: number;
}

export const SEED_DEFAULTS: SeedOptions = {
  annotations: 1_000_000,
  documents: 10_000,
  users: 5_000,
  groups: 500,
  seed: 1,
  truncate: false,
  batchSize: 5_000,
};

export interface SeedSummary {
  users: number;
  groups: number;
  memberships: number;
  documents: number;
  annotations: number;
  deleted: number;
  bodies: number;
  targets: number;
  sharedWithGroup: number;
  sharedWithAuthenticated: number;
  sharedWithPublic: number;
  aclRows: number;
  events: number;
  seconds: number;
}

/** Shares of annotations by how they are shared beyond their creator. */
export const SHARING = { creatorOnly: 0.5, group: 0.25, authenticated: 0.1, public: 0.15 };
/** Skew of annotations over documents and over creators: 1/(rank+1)^s. */
const DOCUMENT_SKEW = 0.8;
const CREATOR_SKEW = 0.8;
/** Skew of group popularity when users pick groups. */
const GROUP_SKEW = 1.0;
const DAYS_OF_HISTORY = 730;
const DELETED_SHARE = 0.02;
const UPDATED_SHARE = 0.1;

const PUBLIC_ID = '00000000-0000-0000-0000-000000000001';
const AUTHENTICATED_ID = '00000000-0000-0000-0000-000000000002';

interface Column {
  name: string;
  /** Postgres array element type the parameter is sent as. */
  type: string;
  /** Expression over the unnested column, when the stored type differs. */
  expr?: string;
}

type Log = (message: string) => void;

async function insertRows(
  client: pg.Client,
  table: string,
  columns: Column[],
  values: unknown[][],
): Promise<void> {
  if ((values[0]?.length ?? 0) === 0) return;
  const params = columns.map((c, i) => `$${i + 1}::${c.type}[]`).join(', ');
  const names = columns.map((c) => c.name).join(', ');
  const select = columns.map((c) => c.expr ?? c.name).join(', ');
  await client.query(
    `insert into ${table} (${names}) select ${select} from unnest(${params}) as u(${names})`,
    values,
  );
}

/** How many groups a user joins: most join a few, a tenth none, one in a hundred a great many. */
function membershipCount(rand: Random): number {
  const r = rand();
  if (r < 0.1) return 0;
  if (r > 0.99) return randomInt(rand, 15, 40);
  let k = 1;
  while (rand() < 0.45 && k < 8) k++;
  return k;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function seedLoadData(
  databaseUrl: string,
  overrides: Partial<SeedOptions> = {},
  log: Log = () => undefined,
): Promise<SeedSummary> {
  const options = { ...SEED_DEFAULTS, ...overrides };
  const started = Date.now();
  await migrate(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const existing = await client.query<{ n: string }>('select count(*) as n from annotations');
    if (Number(existing.rows[0]?.n) > 0) {
      if (!options.truncate) {
        throw new Error('the database already holds annotations; pass --truncate to replace them');
      }
      log('removing existing data');
      await client.query(
        'truncate annotation_events, acl, bodies, targets, annotations, document_uris, documents, group_memberships, groups restart identity',
      );
      await client.query('delete from users');
      await client.query(`delete from principals where kind in ('user', 'group')`);
    }
    await client.query('begin');
    await client.query('set local synchronous_commit = off');
    await client.query('alter table annotation_events disable trigger annotation_events_notify');

    // Principals: users, then groups, then who belongs where.
    const stream = (name: string) => rng(hashSeed(options.seed, name));
    const userRand = stream('users');
    const userIds: string[] = [];
    for (let i = 0; i < options.users; i++) userIds.push(uuidFrom(userRand));
    await insertRows(
      client,
      'principals',
      [
        { name: 'id', type: 'uuid' },
        { name: 'kind', type: 'text' },
      ],
      [userIds, userIds.map(() => 'user')],
    );
    await insertRows(
      client,
      'users',
      [
        { name: 'principal_id', type: 'uuid' },
        { name: 'issuer', type: 'text' },
        { name: 'subject', type: 'text' },
        { name: 'display_name', type: 'text' },
        { name: 'email', type: 'text' },
      ],
      [
        userIds,
        userIds.map(() => LOAD_ISSUER),
        userIds.map((_, i) => userSubject(i)),
        userIds.map((_, i) => `Load User ${i}`),
        userIds.map((_, i) => `${userSubject(i)}@load.example`),
      ],
    );
    log(`users: ${userIds.length}`);

    const groupRand = stream('groups');
    const groupIds: string[] = [];
    for (let i = 0; i < options.groups; i++) groupIds.push(uuidFrom(groupRand));
    await insertRows(
      client,
      'principals',
      [
        { name: 'id', type: 'uuid' },
        { name: 'kind', type: 'text' },
      ],
      [groupIds, groupIds.map(() => 'group')],
    );
    await insertRows(
      client,
      'groups',
      [
        { name: 'principal_id', type: 'uuid' },
        { name: 'name', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'created_by', type: 'uuid' },
      ],
      [
        groupIds,
        groupIds.map((_, i) => groupName(i)),
        groupIds.map((_, i) => `Load test group ${i}`),
        groupIds.map(() => userIds[randomInt(groupRand, 0, userIds.length - 1)]),
      ],
    );

    const membershipRand = stream('memberships');
    const groupZipf = new Zipf(groupIds.length, GROUP_SKEW);
    const groupsOfUser: string[][] = [];
    const memberGroup: string[] = [];
    const memberUser: string[] = [];
    for (const userId of userIds) {
      const picked = new Set<string>();
      const n = groupIds.length === 0 ? 0 : membershipCount(membershipRand);
      for (let k = 0; k < n; k++) picked.add(groupIds[groupZipf.sample(membershipRand)] as string);
      const mine = [...picked];
      groupsOfUser.push(mine);
      for (const g of mine) {
        memberGroup.push(g);
        memberUser.push(userId);
      }
    }
    await insertRows(
      client,
      'group_memberships',
      [
        { name: 'group_id', type: 'uuid' },
        { name: 'user_id', type: 'uuid' },
      ],
      [memberGroup, memberUser],
    );
    log(`groups: ${groupIds.length}, memberships: ${memberGroup.length}`);

    // Documents, each with its own URI and some with a second one.
    const documentRand = stream('documents');
    const documentText = new TextGenerator(documentRand);
    const documentIds: string[] = [];
    const titles: string[] = [];
    const uriDocument: string[] = [];
    const uriValue: string[] = [];
    const uriRelation: string[] = [];
    for (let i = 0; i < options.documents; i++) {
      documentIds.push(uuidFrom(documentRand));
      titles.push(titleCase(documentText.phrase(3, 8)));
      uriDocument.push(documentIds[i] as string);
      uriValue.push(documentUri(i));
      uriRelation.push('self');
      if (documentRand() < 0.3) {
        uriDocument.push(documentIds[i] as string);
        uriValue.push(`https://doi.org/10.5555/load.${i}`);
        uriRelation.push('canonical');
      }
    }
    for (let at = 0; at < documentIds.length; at += options.batchSize) {
      const end = Math.min(at + options.batchSize, documentIds.length);
      await insertRows(
        client,
        'documents',
        [
          { name: 'id', type: 'uuid' },
          { name: 'title', type: 'text' },
        ],
        [documentIds.slice(at, end), titles.slice(at, end)],
      );
    }
    for (let at = 0; at < uriValue.length; at += options.batchSize) {
      const end = Math.min(at + options.batchSize, uriValue.length);
      await insertRows(
        client,
        'document_uris',
        [
          { name: 'document_id', type: 'uuid' },
          { name: 'uri', type: 'text' },
          { name: 'uri_normalized', type: 'text' },
          { name: 'relation', type: 'text' },
        ],
        [
          uriDocument.slice(at, end),
          uriValue.slice(at, end),
          uriValue.slice(at, end),
          uriRelation.slice(at, end),
        ],
      );
    }
    log(`documents: ${documentIds.length}, uris: ${uriValue.length}`);

    // Annotations, in batches: each with one target on its document, its
    // bodies, and the grants beyond the creator's own.
    const annotationRand = stream('annotations');
    const text = new TextGenerator(annotationRand);
    const documentZipf = new Zipf(documentIds.length, DOCUMENT_SKEW);
    const creatorZipf = new Zipf(userIds.length, CREATOR_SKEW);
    const now = Date.now();
    const summary = {
      deleted: 0,
      bodies: 0,
      targets: 0,
      sharedWithGroup: 0,
      sharedWithAuthenticated: 0,
      sharedWithPublic: 0,
    };
    const annotationColumns: Column[] = [
      { name: 'id', type: 'uuid' },
      { name: 'document_id', type: 'uuid' },
      { name: 'created_by', type: 'uuid' },
      { name: 'created_at', type: 'timestamptz' },
      { name: 'updated_at', type: 'timestamptz' },
      { name: 'deleted_at', type: 'timestamptz' },
      { name: 'motivation', type: 'text', expr: `string_to_array(motivation, ',')` },
      { name: 'data', type: 'text', expr: 'data::jsonb' },
    ];
    const targetColumns: Column[] = [
      { name: 'annotation_id', type: 'uuid' },
      { name: 'position', type: 'int' },
      { name: 'source', type: 'text' },
      { name: 'document_id', type: 'uuid' },
      { name: 'selectors', type: 'text', expr: 'selectors::jsonb' },
      { name: 'anchoring_state', type: 'text' },
      { name: 'data', type: 'text', expr: 'data::jsonb' },
    ];
    const bodyColumns: Column[] = [
      { name: 'annotation_id', type: 'uuid' },
      { name: 'position', type: 'int' },
      { name: 'body', type: 'text', expr: 'body::jsonb' },
    ];
    const aclColumns: Column[] = [
      { name: 'annotation_id', type: 'uuid' },
      { name: 'principal_id', type: 'uuid' },
      { name: 'permission', type: 'text' },
      { name: 'granted_by', type: 'uuid' },
    ];
    let nextProgress = Math.ceil(options.annotations / 10);
    for (let at = 0; at < options.annotations; at += options.batchSize) {
      const n = Math.min(options.batchSize, options.annotations - at);
      const a: unknown[][] = annotationColumns.map(() => []);
      const t: unknown[][] = targetColumns.map(() => []);
      const b: unknown[][] = bodyColumns.map(() => []);
      const g: unknown[][] = aclColumns.map(() => []);
      const push = (into: unknown[][], row: unknown[]) => {
        for (let i = 0; i < row.length; i++) (into[i] as unknown[]).push(row[i]);
      };
      for (let i = 0; i < n; i++) {
        const id = uuidFrom(annotationRand);
        const doc = documentZipf.sample(annotationRand);
        const creatorIndex = creatorZipf.sample(annotationRand);
        const creator = userIds[creatorIndex] as string;
        const createdMs = now - annotationRand() * DAYS_OF_HISTORY * 86_400_000;
        const created = new Date(createdMs).toISOString();
        let updated = created;
        if (annotationRand() < UPDATED_SHARE) {
          updated = new Date(createdMs + annotationRand() * 30 * 86_400_000).toISOString();
        }
        let deleted: string | null = null;
        if (annotationRand() < DELETED_SHARE) {
          deleted = new Date(Date.parse(updated) + annotationRand() * 86_400_000).toISOString();
          updated = deleted;
          summary.deleted++;
        }
        const m = annotationRand();
        const motivation =
          m < 0.65
            ? 'commenting'
            : m < 0.85
              ? 'highlighting'
              : m < 0.95
                ? 'tagging'
                : 'classifying';
        push(a, [id, documentIds[doc], creator, created, updated, deleted, motivation, '{}']);

        const exact = text.phrase(3, 10);
        const start = randomInt(annotationRand, 0, 20_000);
        const selectors = JSON.stringify([
          {
            type: 'TextQuoteSelector',
            exact,
            prefix: text.phrase(2, 5),
            suffix: text.phrase(2, 5),
          },
          { type: 'TextPositionSelector', start, end: start + exact.length },
        ]);
        const state = annotationRand() < 0.03 ? 'orphaned' : 'anchored';
        push(t, [
          id,
          0,
          documentUri(doc),
          documentIds[doc],
          selectors,
          state,
          '{"$shape":"specific"}',
        ]);
        summary.targets++;

        let position = 0;
        const body = (value: Record<string, unknown>) => {
          push(b, [id, position++, JSON.stringify(value)]);
          summary.bodies++;
        };
        if (motivation === 'tagging') {
          body({ type: 'TextualBody', value: text.contentWord(), purpose: 'tagging' });
          if (annotationRand() < 0.5) {
            body({
              type: 'TextualBody',
              value: text.paragraph(),
              purpose: 'commenting',
              format: 'text/plain',
            });
          }
        } else if (motivation !== 'highlighting') {
          body({
            type: 'TextualBody',
            value: text.paragraph(),
            purpose: motivation,
            format: 'text/plain',
          });
        }

        const share = annotationRand();
        const grant = (principal: string, permission: string) =>
          push(g, [id, principal, permission, creator]);
        if (share < SHARING.creatorOnly) {
          // Nothing beyond the creator's own rows.
        } else if (share < SHARING.creatorOnly + SHARING.group) {
          const mine = groupsOfUser[creatorIndex] as string[];
          if (mine.length === 0) {
            grant(AUTHENTICATED_ID, 'read');
            summary.sharedWithAuthenticated++;
          } else {
            const group = mine[randomInt(annotationRand, 0, mine.length - 1)] as string;
            grant(group, 'read');
            if (annotationRand() < 1 / 3) grant(group, 'update');
            summary.sharedWithGroup++;
          }
        } else if (share < SHARING.creatorOnly + SHARING.group + SHARING.authenticated) {
          grant(AUTHENTICATED_ID, 'read');
          summary.sharedWithAuthenticated++;
        } else {
          grant(PUBLIC_ID, 'read');
          summary.sharedWithPublic++;
        }
      }
      await insertRows(client, 'annotations', annotationColumns, a);
      await insertRows(client, 'targets', targetColumns, t);
      await insertRows(client, 'bodies', bodyColumns, b);
      await insertRows(client, 'acl', aclColumns, g);
      if (at + n >= nextProgress) {
        log(`annotations: ${at + n} of ${options.annotations} (${elapsed(started)})`);
        nextProgress += Math.ceil(options.annotations / 10);
      }
    }

    // The creator's own four permissions, as the server grants them.
    await client.query(
      `insert into acl (annotation_id, principal_id, permission, granted_by)
       select a.id, a.created_by, p.permission, a.created_by
       from annotations a cross join (values ('read'), ('update'), ('delete'), ('share')) as p(permission)`,
    );
    log(`acl: creator rows written (${elapsed(started)})`);

    // One event per creation, update and deletion, in time order so that
    // ids follow occurrence as they would in a live system.
    await client.query(
      `insert into annotation_events (annotation_id, document_id, kind, actor_id, occurred_at)
       select id, document_id, kind, created_by, occurred_at from (
         select id, document_id, 'created' as kind, created_by, created_at as occurred_at from annotations
         union all
         select id, document_id, 'updated', created_by, updated_at from annotations
           where updated_at > created_at and deleted_at is null
         union all
         select id, document_id, 'deleted', created_by, deleted_at from annotations
           where deleted_at is not null
       ) e order by occurred_at, id`,
    );
    await client.query('alter table annotation_events enable trigger annotation_events_notify');
    await client.query('commit');
    log(`events written (${elapsed(started)}); analyzing`);
    await client.query('analyze');

    const count = async (table: string): Promise<number> =>
      Number((await client.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);
    return {
      users: userIds.length,
      groups: groupIds.length,
      memberships: memberGroup.length,
      documents: documentIds.length,
      annotations: options.annotations,
      ...summary,
      aclRows: await count('acl'),
      events: await count('annotation_events'),
      seconds: (Date.now() - started) / 1000,
    };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

function elapsed(since: number): string {
  return `${((Date.now() - since) / 1000).toFixed(0)}s`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { values: args } = parseArgs({
    // pnpm passes on the `--` in `pnpm <script> -- --flag`.
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      'database-url': { type: 'string' },
      annotations: { type: 'string' },
      documents: { type: 'string' },
      users: { type: 'string' },
      groups: { type: 'string' },
      seed: { type: 'string' },
      batch: { type: 'string' },
      truncate: { type: 'boolean' },
    },
  });
  const url = args['database-url'] ?? process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const summary = await seedLoadData(
    url,
    {
      annotations: numberArg(args, 'annotations', SEED_DEFAULTS.annotations),
      documents: numberArg(args, 'documents', SEED_DEFAULTS.documents),
      users: numberArg(args, 'users', SEED_DEFAULTS.users),
      groups: numberArg(args, 'groups', SEED_DEFAULTS.groups),
      seed: numberArg(args, 'seed', SEED_DEFAULTS.seed),
      batchSize: numberArg(args, 'batch', SEED_DEFAULTS.batchSize),
      truncate: args['truncate'] === true,
    },
    (message) => console.log(message),
  );
  console.log(JSON.stringify(summary, null, 2));
}
