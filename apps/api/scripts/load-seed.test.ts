/**
 * The seeding script at a smoke size: it fills a scratch database with the
 * shapes the load test relies on, refuses to run twice without --truncate,
 * and produces the same rows for the same seed. Needs DATABASE_URL.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dropDatabase } from '../src/test/harness.ts';
import { seedLoadData } from './load-seed.ts';

const adminUrl = process.env['DATABASE_URL'];
const SIZES = { annotations: 3000, documents: 40, users: 60, groups: 12 };

describe.skipIf(!adminUrl)('load seed', () => {
  let admin: pg.Client;
  let url: string;
  let db: pg.Client;
  const dbName = `annotations_load_${randomBytes(4).toString('hex')}`;

  const count = async (sql: string, params: unknown[] = []): Promise<number> =>
    Number((await db.query<{ n: string }>(sql, params)).rows[0]?.n);
  const checksum = async (): Promise<string> =>
    (
      await db.query<{ md5: string }>(
        `select md5(string_agg(a.id::text || ':' || coalesce(b.text_value, '') || ':' || acl.n, ',' order by a.id))
         from annotations a
         left join bodies b on b.annotation_id = a.id and b.position = 0
         join (select annotation_id, count(*) as n from acl group by 1) acl on acl.annotation_id = a.id`,
      )
    ).rows[0]?.md5 as string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(adminUrl as string);
    u.pathname = `/${dbName}`;
    url = u.href;
    db = new pg.Client({ connectionString: url });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
    await dropDatabase(admin, dbName);
    await admin.end();
  });

  it('fills a migrated database with the documented shapes', async () => {
    const summary = await seedLoadData(url, SIZES);
    expect(summary.annotations).toBe(SIZES.annotations);
    expect(await count('select count(*) as n from annotations')).toBe(SIZES.annotations);
    expect(await count('select count(*) as n from users')).toBe(SIZES.users);
    expect(await count('select count(*) as n from groups where issuer is null')).toBe(SIZES.groups);
    expect(await count('select count(*) as n from documents')).toBe(SIZES.documents);
    expect(summary.memberships).toBeGreaterThan(SIZES.users);
    // Every annotation has one target with a quote and its creator's four permissions.
    expect(await count('select count(*) as n from targets where quote is null')).toBe(0);
    expect(
      await count(
        `select count(*) as n from annotations a where 4 <> (
           select count(*) from acl where acl.annotation_id = a.id and acl.principal_id = a.created_by)`,
      ),
    ).toBe(0);
    // Grants beyond the creator: groups, authenticated and public all appear.
    const kinds = await db.query<{ kind: string }>(
      `select distinct p.kind from acl join principals p on p.id = acl.principal_id`,
    );
    expect(kinds.rows.map((r) => r.kind).sort()).toEqual([
      'authenticated',
      'group',
      'public',
      'user',
    ]);
    expect(
      summary.sharedWithGroup + summary.sharedWithAuthenticated + summary.sharedWithPublic,
    ).toBe(
      await count(
        `select count(*) as n from acl where principal_id <> granted_by and permission = 'read'`,
      ),
    );
    // Events: one creation per annotation, in order of occurrence; the notify trigger is back on.
    expect(await count(`select count(*) as n from annotation_events where kind = 'created'`)).toBe(
      SIZES.annotations,
    );
    expect(
      await count(
        `select count(*) as n from (
           select occurred_at < lag(occurred_at) over (order by id) as backwards from annotation_events
         ) e where backwards`,
      ),
    ).toBe(0);
    const trigger = await db.query<{ tgenabled: string }>(
      `select tgenabled from pg_trigger where tgname = 'annotation_events_notify'`,
    );
    expect(trigger.rows[0]?.tgenabled).toBe('O');
    // Full text indexes something searchable.
    expect(
      await count(
        `select count(*) as n from bodies where text_search @@ websearch_to_tsquery('english', 'variant')`,
      ),
    ).toBeGreaterThan(0);
  });

  it('refuses to seed over existing data unless told to truncate, and is deterministic', async () => {
    const before = await checksum();
    await expect(seedLoadData(url, SIZES)).rejects.toThrow(/--truncate/);
    await seedLoadData(url, { ...SIZES, truncate: true });
    expect(await checksum()).toBe(before);
    await seedLoadData(url, { ...SIZES, truncate: true, seed: 2 });
    expect(await checksum()).not.toBe(before);
    expect(await count('select count(*) as n from body_profiles')).toBeGreaterThanOrEqual(0);
  });
});
