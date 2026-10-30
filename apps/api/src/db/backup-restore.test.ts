/**
 * The backup and restore procedure (operator guide): `scripts/db-backup.sh`
 * dumps a database, `scripts/db-restore.sh` restores it into an empty one,
 * and the restored database serves the API as the original did: the
 * contract suite passes against a restored copy of a fresh database, and a
 * database with annotations, ACLs, documents and events comes back
 * identical as far as the API can tell. Needs pg_dump and pg_restore of at
 * least the server's major version on the path, or `PG_DUMP`/`PG_RESTORE`
 * naming them (CI runs the ones inside the Postgres container).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeContract } from '../contract-suite.js';
import {
  alice,
  annotationOn,
  bob,
  createTestContext,
  databaseUrl,
  dropDatabase,
  withDatabase,
  type TestContext,
} from '../test/harness.js';
import { migrate } from './migrate.js';

const SCRIPTS = fileURLToPath(new URL('../../../../scripts/', import.meta.url));
const PAGE = 'https://example.org/backed-up';

async function createDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  const name = `annotations_restore_${randomBytes(6).toString('hex')}`;
  await admin.query(`create database ${name}`);
  return {
    url: withDatabase(databaseUrl as string, name),
    drop: async () => {
      await dropDatabase(admin, name);
      await admin.end();
    },
  };
}

function backup(fromUrl: string, file: string): void {
  execFileSync('sh', [path.join(SCRIPTS, 'db-backup.sh'), file], {
    env: { ...process.env, DATABASE_URL: fromUrl },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function restore(toUrl: string, file: string): void {
  execFileSync('sh', [path.join(SCRIPTS, 'db-restore.sh'), file], {
    env: { ...process.env, TARGET_DATABASE_URL: toUrl },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

describe.skipIf(!databaseUrl)('backup and restore', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'annotations-backup-'));
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const c of cleanups.reverse()) await c();
  });

  it('restores a populated database that serves the API as before', async () => {
    const original = await createTestContext();
    cleanups.push(() => original.close());
    const shared = await original.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: { 'content-type': 'application/ld+json' },
      payload: annotationOn(PAGE, 'shared with bob'),
    });
    expect(shared.statusCode).toBe(201);
    const sharedId = shared.json<{ id: string }>().id.split('/').pop() as string;
    const bobId = (await original.as(bob, { method: 'GET', url: '/x/me' })).json<{ id: string }>()
      .id;
    const grant = await original.as(alice, {
      method: 'POST',
      url: `/x/annotations/${sharedId}/acl`,
      payload: { principal: bobId, permission: 'read' },
    });
    expect(grant.statusCode).toBe(201);
    const secret = await original.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: { 'content-type': 'application/ld+json' },
      payload: annotationOn(PAGE, 'alice only'),
    });
    expect(secret.statusCode).toBe(201);
    const before = {
      alice: (
        await original.as(alice, { method: 'GET', url: `/x/search?uri=${PAGE}` })
      ).json<unknown>(),
      bob: (
        await original.as(bob, { method: 'GET', url: `/x/search?uri=${PAGE}` })
      ).json<unknown>(),
      anonymous: (
        await original.as(null, { method: 'GET', url: `/x/search?uri=${PAGE}` })
      ).json<unknown>(),
      container: (
        await original.as(alice, { method: 'GET', url: '/annotations/?page=0' })
      ).json<unknown>(),
      events: await original.db.selectFrom('annotation_events').selectAll().orderBy('id').execute(),
    };

    const file = path.join(dir, 'populated.dump');
    backup(original.config.databaseUrl, file);
    const target = await createDatabase();
    cleanups.push(target.drop);
    restore(target.url, file);
    // The restored schema is current: nothing left for the migration runner to do.
    expect((await migrate(target.url)).applied).toEqual([]);

    const restored = await createTestContext({ existingDatabaseUrl: target.url });
    cleanups.push(() => restored.close());
    const after = {
      alice: (
        await restored.as(alice, { method: 'GET', url: `/x/search?uri=${PAGE}` })
      ).json<unknown>(),
      bob: (
        await restored.as(bob, { method: 'GET', url: `/x/search?uri=${PAGE}` })
      ).json<unknown>(),
      anonymous: (
        await restored.as(null, { method: 'GET', url: `/x/search?uri=${PAGE}` })
      ).json<unknown>(),
      container: (
        await restored.as(alice, { method: 'GET', url: '/annotations/?page=0' })
      ).json<unknown>(),
      events: await restored.db.selectFrom('annotation_events').selectAll().orderBy('id').execute(),
    };
    expect(after).toEqual(before);
    expect((after.alice as { total: number }).total).toBe(2);
    expect((after.bob as { total: number }).total).toBe(1);
    expect((after.anonymous as { total: number }).total).toBe(0);
    // And it keeps working: a write after the restore fires the event trigger as before.
    const more = await restored.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: { 'content-type': 'application/ld+json' },
      payload: annotationOn(PAGE, 'after the restore'),
    });
    expect(more.statusCode).toBe(201);
    const events = await restored.db.selectFrom('annotation_events').selectAll().execute();
    expect(events.length).toBe(before.events.length + 1);
  });

  // The whole contract on a restored copy of a fresh database.
  let restoredFresh: TestContext | undefined;
  beforeAll(async () => {
    if (!databaseUrl) return;
    const fresh = await createTestContext();
    const file = path.join(dir, 'fresh.dump');
    backup(fresh.config.databaseUrl, file);
    await fresh.close();
    const target = await createDatabase();
    cleanups.push(target.drop);
    restore(target.url, file);
    restoredFresh = await createTestContext({ existingDatabaseUrl: target.url });
    cleanups.push(() => restoredFresh?.close() ?? Promise.resolve());
  });
  describeContract('OpenAPI contract on a restored database', () => {
    if (!restoredFresh) throw new Error('no restored database');
    return Promise.resolve(restoredFresh);
  });
});
