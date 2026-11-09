/**
 * The load test of docs/performance.md: drives the API over a database
 * filled by load-seed.ts as several principals with different group
 * memberships, reports latency percentiles and throughput per scenario,
 * and explains the main search queries under that volume.
 *
 *   DATABASE_URL=postgres://... node --experimental-strip-types scripts/load-run.ts \
 *     [--duration 10] [--connections 10] [--out results.json] [--only <substring>] [--no-explain]
 *
 * The API runs in a child process (load-server.ts) built from `dist/`, so
 * `pnpm build` first. Tokens are minted here for seeded users; the server
 * trusts this run's key for the load issuer.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import autocannon from 'autocannon';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import pg from 'pg';
import type { Caller } from '../dist/auth/caller.js';
import { AnnotationStore, type ListOptions } from '../dist/annotations/store.js';
import { createDb } from '../dist/db/index.js';
import {
  LOAD_CLIENT_ID,
  LOAD_ISSUER,
  SEARCH_TERM_RANKS,
  numberArg,
  parseArgs,
  vocabulary,
} from './load-common.ts';

const PUBLIC_ID = '00000000-0000-0000-0000-000000000001';
const AUTHENTICATED_ID = '00000000-0000-0000-0000-000000000002';
/** Events in the first page of a replay (replayPageSize in the server); a scenario times that page. */
const REPLAY_LIMIT = 1000;
const CONTAINER_PAGE_SIZE = 20;

interface Principal {
  name: string;
  userId: string | null;
  subject: string | null;
  groups: string[];
  description: string;
}

interface Fixtures {
  hotDocument: { id: string; uri: string; annotations: number };
  midDocument: { id: string; uri: string; annotations: number };
  topCreator: { id: string; annotations: number };
  principals: Record<'anonymous' | 'light' | 'heavy' | 'creator', Principal>;
  terms: Record<keyof typeof SEARCH_TERM_RANKS, string>;
  firstEventId: number;
  lastEventId: number;
  hotDocumentEvents: number;
}

interface Scenario {
  name: string;
  principal: Principal;
  /** Path and query, or an SSE replay description. */
  path: string;
  sse?: { lastEventId: number; expectedIds: number };
}

interface Measurement {
  scenario: string;
  principal: string;
  path: string;
  requests: number;
  perSecond: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errors: number;
  /** SSE only: time to the first id line, p50/p95. */
  firstEvent?: { p50: number; p95: number };
  /** The response's `total`, for context. */
  total?: number;
}

const args = parseArgs(process.argv.slice(2));
const databaseUrl = (args['database-url'] as string | undefined) ?? process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const duration = numberArg(args, 'duration', 10);
const connections = numberArg(args, 'connections', 10);
const only = typeof args['only'] === 'string' ? args['only'] : undefined;
const out = typeof args['out'] === 'string' ? args['out'] : undefined;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const fixtures = await loadFixtures(client);
console.log('Fixtures');
console.log(
  `  hot document: ${fixtures.hotDocument.uri} (${fixtures.hotDocument.annotations} annotations)`,
);
console.log(
  `  mid document: ${fixtures.midDocument.uri} (${fixtures.midDocument.annotations} annotations)`,
);
console.log(
  `  top creator: ${fixtures.topCreator.id} (${fixtures.topCreator.annotations} annotations)`,
);
for (const p of Object.values(fixtures.principals)) console.log(`  ${p.name}: ${p.description}`);
console.log(`  search terms: ${JSON.stringify(fixtures.terms)}`);
console.log(
  `  events: ${fixtures.firstEventId}..${fixtures.lastEventId}, ${fixtures.hotDocumentEvents} on the hot document`,
);

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'load', alg: 'ES256' };
const server = await startServer(databaseUrl, JSON.stringify(jwk));
const tokens = new Map<string, string>();
for (const principal of Object.values(fixtures.principals)) {
  if (principal.subject === null) continue;
  tokens.set(
    principal.name,
    await new SignJWT({ name: principal.name, azp: LOAD_CLIENT_ID })
      .setProtectedHeader({ alg: 'ES256', kid: 'load' })
      .setIssuer(LOAD_ISSUER)
      .setSubject(principal.subject)
      .setAudience(LOAD_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(privateKey),
  );
}

const measurements: Measurement[] = [];
try {
  for (const scenario of scenarios(fixtures)) {
    if (only !== undefined && !scenario.name.includes(only)) continue;
    const measurement = scenario.sse
      ? await runSse(server.url, scenario)
      : await runHttp(server.url, scenario);
    measurements.push(measurement);
    console.log(formatRow(measurement));
  }
  console.log('\n' + table(measurements));
  const plans = args['no-explain'] === true ? [] : await explainQueries(fixtures);
  for (const plan of plans) {
    console.log(`\n## ${plan.title}\n\n${plan.sql}\n\n${plan.plan}`);
  }
  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        { ranAt: new Date().toISOString(), duration, connections, fixtures, measurements, plans },
        null,
        2,
      ),
    );
    console.log(`\nresults written to ${out}`);
  }
} finally {
  server.process.kill('SIGTERM');
  await client.end();
}

// --- fixtures -------------------------------------------------------------

async function loadFixtures(db: pg.Client): Promise<Fixtures> {
  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const row = (await db.query<T>(sql, params)).rows[0];
    if (!row) throw new Error(`no row for: ${sql}`);
    return row;
  };
  const documentAt = async (offset: number) => {
    const row = await one<{ id: string; uri: string; n: string }>(
      `select d.document_id as id, u.uri, d.n from (
         select document_id, count(*) as n from annotations where deleted_at is null group by 1
         order by n desc, document_id offset $1 limit 1
       ) d join document_uris u on u.document_id = d.document_id and u.relation = 'self'`,
      [offset],
    );
    return { id: row.id, uri: row.uri, annotations: Number(row.n) };
  };
  const documents = Number((await one<{ n: string }>('select count(*) as n from documents')).n);
  const hotDocument = await documentAt(0);
  const midDocument = await documentAt(Math.floor(documents / 2));
  const creator = await one<{ id: string; n: string }>(
    'select created_by as id, count(*) as n from annotations group by 1 order by n desc, created_by limit 1',
  );
  const heavy = await one<{ user_id: string }>(
    'select user_id from group_memberships group by 1 order by count(*) desc, user_id limit 1',
  );
  // A member of exactly one group, the smallest such group.
  const light = await one<{ user_id: string }>(
    `select m.user_id from group_memberships m
     join (select group_id, count(*) as size from group_memberships group by 1) g using (group_id)
     where (select count(*) from group_memberships x where x.user_id = m.user_id) = 1
     order by g.size, m.user_id limit 1`,
  );
  const principal = async (name: string, userId: string | null): Promise<Principal> => {
    if (userId === null) {
      return { name, userId, subject: null, groups: [], description: 'no token: public only' };
    }
    const user = await one<{ subject: string }>(
      'select subject from users where principal_id = $1',
      [userId],
    );
    const groups = (
      await db.query<{ group_id: string; size: string }>(
        `select m.group_id, (select count(*) from group_memberships x where x.group_id = m.group_id) as size
         from group_memberships m where m.user_id = $1 order by size desc`,
        [userId],
      )
    ).rows;
    const own = Number(
      (
        await one<{ n: string }>('select count(*) as n from annotations where created_by = $1', [
          userId,
        ])
      ).n,
    );
    return {
      name,
      userId,
      subject: user.subject,
      groups: groups.map((g) => g.group_id),
      description: `${groups.length} group(s) of sizes ${groups.map((g) => g.size).join(', ') || '-'}; ${own} own annotations`,
    };
  };
  const events = await one<{ min: string; max: string }>(
    'select min(id), max(id) from annotation_events',
  );
  const firstEventId = Number(events.min);
  const hotEvents = await one<{ n: string }>(
    'select count(*) as n from annotation_events where document_id = $1 and id > $2',
    [hotDocument.id, firstEventId],
  );
  const words = vocabulary();
  return {
    hotDocument,
    midDocument,
    topCreator: { id: creator.id, annotations: Number(creator.n) },
    principals: {
      anonymous: await principal('anonymous', null),
      light: await principal('light', light.user_id),
      heavy: await principal('heavy', heavy.user_id),
      creator: await principal('creator', creator.id),
    },
    terms: {
      common: words[SEARCH_TERM_RANKS.common] as string,
      mid: words[SEARCH_TERM_RANKS.mid] as string,
      rare: words[SEARCH_TERM_RANKS.rare] as string,
    },
    firstEventId,
    lastEventId: Number(events.max),
    hotDocumentEvents: Number(hotEvents.n),
  };
}

function scenarios(f: Fixtures): Scenario[] {
  const { anonymous, light, heavy, creator } = f.principals;
  const q = encodeURIComponent;
  const list: Scenario[] = [
    {
      name: 'container hot document',
      principal: anonymous,
      path: `/annotations/?target=${q(f.hotDocument.uri)}`,
    },
    {
      name: 'container hot document',
      principal: light,
      path: `/annotations/?target=${q(f.hotDocument.uri)}`,
    },
    {
      name: 'container hot document',
      principal: heavy,
      path: `/annotations/?target=${q(f.hotDocument.uri)}`,
    },
    {
      name: 'container mid document',
      principal: heavy,
      path: `/annotations/?target=${q(f.midDocument.uri)}`,
    },
    {
      name: 'container hot document, deep page',
      principal: heavy,
      path: `/annotations/?target=${q(f.hotDocument.uri)}&page=${Math.floor(f.hotDocument.annotations / 4 / CONTAINER_PAGE_SIZE)}&iris=1`,
    },
    {
      name: 'search text common',
      principal: anonymous,
      path: `/x/search?text=${q(f.terms.common)}`,
    },
    { name: 'search text common', principal: heavy, path: `/x/search?text=${q(f.terms.common)}` },
    { name: 'search text mid', principal: heavy, path: `/x/search?text=${q(f.terms.mid)}` },
    { name: 'search text rare', principal: heavy, path: `/x/search?text=${q(f.terms.rare)}` },
    {
      name: 'search text common in hot document',
      principal: heavy,
      path: `/x/search?document=${f.hotDocument.id}&text=${q(f.terms.common)}`,
    },
    { name: 'search by creator', principal: heavy, path: `/x/search?creator=${f.topCreator.id}` },
    { name: 'search by creator', principal: creator, path: `/x/search?creator=${f.topCreator.id}` },
    {
      name: 'search in hot document, no text',
      principal: heavy,
      path: `/x/search?document=${f.hotDocument.id}`,
    },
    { name: 'search without filters', principal: anonymous, path: '/x/search' },
    { name: 'search without filters', principal: heavy, path: '/x/search' },
    {
      name: 'search text common, offset 5000',
      principal: heavy,
      path: `/x/search?text=${q(f.terms.common)}&offset=5000`,
    },
    {
      name: 'search without filters, offset 100000',
      principal: heavy,
      path: '/x/search?offset=100000',
    },
    {
      name: 'SSE replay from the start',
      principal: heavy,
      path: '/x/events',
      sse: { lastEventId: f.firstEventId, expectedIds: REPLAY_LIMIT },
    },
    {
      name: 'SSE replay from the start',
      principal: anonymous,
      path: '/x/events',
      sse: { lastEventId: f.firstEventId, expectedIds: REPLAY_LIMIT },
    },
    {
      name: 'SSE replay from the start, hot document',
      principal: heavy,
      path: `/x/events?document=${f.hotDocument.id}`,
      sse: {
        lastEventId: f.firstEventId,
        expectedIds: Math.min(REPLAY_LIMIT, f.hotDocumentEvents),
      },
    },
  ];
  return list;
}

// --- the API process ------------------------------------------------------

async function startServer(
  url: string,
  jwkJson: string,
): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', new URL('./load-server.ts', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        DATABASE_URL: url,
        LOAD_JWK: jwkJson,
        PORT: '0',
        NODE_NO_WARNINGS: '1',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  if (!child.stdout) throw new Error('the API process has no stdout');
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      const parsed = parseJsonLine(line);
      if (parsed?.['listening']) resolve({ process: child, url: parsed['listening'] as string });
      else console.log(`[api] ${line}`);
    });
    void once(child, 'exit').then(([code]) =>
      reject(new Error(`the API exited with code ${String(code)} before listening`)),
    );
  });
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// --- HTTP scenarios through autocannon ---------------------------------------

function headersFor(principal: Principal): Record<string, string> {
  const token = tokens.get(principal.name);
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function runHttp(base: string, scenario: Scenario): Promise<Measurement> {
  const url = base + scenario.path;
  const headers = headersFor(scenario.principal);
  const first = await fetch(url, { headers });
  if (!first.ok) throw new Error(`${scenario.name}: ${first.status} ${await first.text()}`);
  const body = (await first.json()) as { total?: number };
  // Warm the caches and the plans, then measure.
  await cannon(url, headers, Math.min(2, duration));
  const { result, samples } = await cannon(url, headers, duration);
  const p = percentiles(samples);
  return {
    scenario: scenario.name,
    principal: scenario.principal.name,
    path: scenario.path,
    requests: samples.length,
    perSecond: result.requests.average,
    ...p,
    errors: result.errors + result.non2xx + result.timeouts,
    ...(body.total !== undefined ? { total: body.total } : {}),
  };
}

function cannon(
  url: string,
  headers: Record<string, string>,
  seconds: number,
): Promise<{ result: autocannon.Result; samples: number[] }> {
  const samples: number[] = [];
  return new Promise((resolve, reject) => {
    const instance = autocannon({ url, headers, connections, duration: seconds }, (err, result) =>
      err
        ? reject(err instanceof Error ? err : new Error(String(err)))
        : resolve({ result, samples }),
    );
    // The tracker emits (client, statusCode, resBytes, responseTime); the typings omit the client.
    (instance as unknown as { on(event: string, fn: (...a: unknown[]) => void): void }).on(
      'response',
      (_client, _status, _bytes, responseTime) => samples.push(responseTime as number),
    );
  });
}

// --- SSE replay -------------------------------------------------------------

async function runSse(base: string, scenario: Scenario): Promise<Measurement> {
  const sse = scenario.sse as NonNullable<Scenario['sse']>;
  const url = base + scenario.path;
  const headers = { ...headersFor(scenario.principal), 'last-event-id': String(sse.lastEventId) };
  await replayOnce(url, headers, sse.expectedIds);
  const totals: number[] = [];
  const firsts: number[] = [];
  let errors = 0;
  const deadline = Date.now() + duration * 1000;
  const worker = async (): Promise<void> => {
    while (Date.now() < deadline) {
      try {
        const timing = await replayOnce(url, headers, sse.expectedIds);
        totals.push(timing.total);
        firsts.push(timing.first);
      } catch (err) {
        errors++;
        console.error(`${scenario.name}: ${(err as Error).message}`);
      }
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: connections }, worker));
  const elapsed = (Date.now() - started) / 1000;
  const p = percentiles(totals);
  const f = percentiles(firsts);
  return {
    scenario: scenario.name,
    principal: scenario.principal.name,
    path: `${scenario.path} (Last-Event-ID: ${sse.lastEventId}, ${sse.expectedIds} ids)`,
    requests: totals.length,
    perSecond: totals.length / elapsed,
    ...p,
    errors,
    firstEvent: { p50: f.p50, p95: f.p95 },
  };
}

/** Opens a stream and reads until `expectedIds` id lines arrived; ms to the first and to the last. */
async function replayOnce(
  url: string,
  headers: Record<string, string>,
  expectedIds: number,
): Promise<{ first: number; total: number }> {
  const controller = new AbortController();
  const started = performance.now();
  const res = await fetch(url, { headers, signal: controller.signal });
  if (!res.ok || !res.body) throw new Error(`event stream answered ${res.status}`);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ids = 0;
  let first = 0;
  try {
    while (ids < expectedIds) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended after ${ids} of ${expectedIds} ids`);
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('id: ')) {
          ids++;
          if (ids === 1) first = performance.now() - started;
        }
      }
    }
  } finally {
    controller.abort();
  }
  return { first, total: performance.now() - started };
}

// --- EXPLAIN ----------------------------------------------------------------

async function explainQueries(
  f: Fixtures,
): Promise<{ title: string; sql: string; plan: string }[]> {
  const heavy = f.principals.heavy;
  const caller: Caller = {
    kind: 'user',
    userId: heavy.userId as string,
    displayName: heavy.name,
    isAdmin: false,
    status: 'active',
    principalIds: [heavy.userId as string, AUTHENTICATED_ID, PUBLIC_ID, ...heavy.groups],
  };
  const db = createDb(databaseUrl as string);
  const store = new AnnotationStore(db, 'http://127.0.0.1');
  const cases: { title: string; options: ListOptions }[] = [
    {
      title: 'search text common (heavy)',
      options: { text: f.terms.common, limit: 50, offset: 0 },
    },
    {
      title: 'container hot document (heavy)',
      options: { documentId: f.hotDocument.id, limit: CONTAINER_PAGE_SIZE, offset: 0 },
    },
    {
      title: 'search text common in hot document (heavy)',
      options: { documentId: f.hotDocument.id, text: f.terms.common, limit: 50, offset: 0 },
    },
    {
      title: 'container mid document (heavy)',
      options: { documentId: f.midDocument.id, limit: CONTAINER_PAGE_SIZE, offset: 0 },
    },
    {
      title: 'search by creator (heavy)',
      options: { creator: f.topCreator.id, limit: 50, offset: 0 },
    },
    { title: 'search without filters (heavy)', options: { limit: 50, offset: 0 } },
    {
      title: 'search without filters, offset 100000 (heavy)',
      options: { limit: 50, offset: 100000 },
    },
  ];
  const plans: { title: string; sql: string; plan: string }[] = [];
  const explain = async (
    title: string,
    compiled: { sql: string; parameters: readonly unknown[] },
  ) => {
    const rows = await client.query<{ 'QUERY PLAN': string }>(
      `explain (analyze, buffers) ${compiled.sql}`,
      [...compiled.parameters],
    );
    plans.push({
      title,
      sql: compiled.sql,
      plan: rows.rows.map((r) => r['QUERY PLAN']).join('\n'),
    });
  };
  try {
    for (const { title, options } of cases) {
      const queries = store.listQueries(caller, options);
      await explain(`${title}: total and page ids`, queries.page.compile());
      const page = await queries.page.executeTakeFirstOrThrow();
      const ids = page.ids.map((row) => row.id);
      if (ids.length > 0) await explain(`${title}: records`, queries.records(ids).compile());
    }
  } finally {
    await db.destroy();
  }
  return plans;
}

// --- reporting ----------------------------------------------------------------

function percentiles(samples: number[]): { p50: number; p95: number; p99: number; max: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
  return { p50: at(50), p95: at(95), p99: at(99), max: sorted[sorted.length - 1] as number };
}

function ms(n: number): string {
  return n.toFixed(1);
}

function formatRow(m: Measurement): string {
  const extra = m.firstEvent
    ? ` first id p50 ${ms(m.firstEvent.p50)} p95 ${ms(m.firstEvent.p95)}`
    : '';
  return `${m.scenario} [${m.principal}]: ${m.requests} req, ${m.perSecond.toFixed(1)} req/s, p50 ${ms(m.p50)} p95 ${ms(m.p95)} p99 ${ms(m.p99)} max ${ms(m.max)} ms, errors ${m.errors}${m.total !== undefined ? `, total ${m.total}` : ''}${extra}`;
}

function table(rows: Measurement[]): string {
  const lines = [
    '| Scenario | Principal | Total | req/s | p50 ms | p95 ms | p99 ms | Errors |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const m of rows) {
    lines.push(
      `| ${m.scenario} | ${m.principal} | ${m.total ?? ''} | ${m.perSecond.toFixed(1)} | ${ms(m.p50)} | ${ms(m.p95)} | ${ms(m.p99)} | ${m.errors} |`,
    );
  }
  return lines.join('\n');
}
