/**
 * Applies the migrations to a fresh database and exercises the schema.
 * Needs a Postgres reachable through DATABASE_URL (the compose stack, or
 * the service container in CI); skipped otherwise.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, listMigrations, migrate, PUBLIC_PRINCIPAL_ID } from './index.js';

const adminUrl = process.env['DATABASE_URL'];
const dbName = `annotations_test_${Date.now().toString(36)}`;

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.href;
}

describe.skipIf(!adminUrl)('migrations', () => {
  const url = adminUrl ?? '';
  let testUrl = '';
  let admin: pg.Client;

  beforeAll(async () => {
    testUrl = withDatabase(url, dbName);
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
  });

  afterAll(async () => {
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it('apply to a fresh database and are idempotent', async () => {
    const first = await migrate(testUrl);
    expect(first.applied).toEqual(listMigrations().map((m) => m.name));
    const second = await migrate(testUrl);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
  });

  it('store an annotation with generated search columns and ACL rows', async () => {
    const db = createDb(testUrl);
    try {
      const principal = await db
        .insertInto('principals')
        .values({ kind: 'user' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('users')
        .values({ principal_id: principal.id, issuer: 'https://idp.example', subject: 'alice' })
        .execute();
      const doc = await db
        .insertInto('documents')
        .values({ title: 'A page' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('document_uris')
        .values({
          document_id: doc.id,
          uri: 'https://example.org/page?utm_source=x',
          uri_normalized: 'https://example.org/page',
          relation: 'self',
        })
        .execute();
      const ann = await db
        .insertInto('annotations')
        .values({ document_id: doc.id, created_by: principal.id, motivation: ['commenting'] })
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow();
      expect(ann.version).toBe(1);
      await db
        .insertInto('targets')
        .values({
          annotation_id: ann.id,
          position: 0,
          source: 'https://example.org/page',
          document_id: doc.id,
          selectors: JSON.stringify([
            {
              type: 'CssSelector',
              value: 'main',
              refinedBy: { type: 'TextQuoteSelector', exact: 'quoted words' },
            },
            { type: 'TextPositionSelector', start: 1, end: 13 },
          ]),
        })
        .execute();
      await db
        .insertInto('bodies')
        .values({
          annotation_id: ann.id,
          position: 0,
          body: JSON.stringify({
            type: 'TextualBody',
            value: 'Searchable comment',
            purpose: 'commenting',
          }),
        })
        .execute();
      await db
        .insertInto('acl')
        .values([
          { annotation_id: ann.id, principal_id: principal.id, permission: 'read' },
          { annotation_id: ann.id, principal_id: PUBLIC_PRINCIPAL_ID, permission: 'read' },
        ])
        .execute();

      const target = await db
        .selectFrom('targets')
        .select(['quote', 'anchoring_state'])
        .executeTakeFirstOrThrow();
      expect(target.quote).toBe('quoted words');
      expect(target.anchoring_state).toBe('anchored');

      const body = await db
        .selectFrom('bodies')
        .select(['body_type', 'text_value', 'profile'])
        .executeTakeFirstOrThrow();
      expect(body).toEqual({
        body_type: 'TextualBody',
        text_value: 'Searchable comment',
        profile: null,
      });

      const client = new pg.Client({ connectionString: testUrl });
      await client.connect();
      try {
        const hit = await client.query(
          `select a.id from annotations a
             join bodies b on b.annotation_id = a.id
             join acl on acl.annotation_id = a.id and acl.permission = 'read' and acl.principal_id = $1
            where b.text_search @@ plainto_tsquery('english', 'searchable')`,
          [PUBLIC_PRINCIPAL_ID],
        );
        expect(hit.rows.map((r: { id: string }) => r.id)).toEqual([ann.id]);
        await expect(
          client.query(
            `insert into targets (annotation_id, position, source, anchoring_state) values ($1, 1, 'x', 'repaired')`,
            [ann.id],
          ),
        ).rejects.toThrow(/check constraint/);
      } finally {
        await client.end();
      }
    } finally {
      await db.destroy();
    }
  });
});
