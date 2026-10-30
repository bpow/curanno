/**
 * Applies the plain SQL migrations in apps/api/migrations in file order,
 * recording each in `schema_migrations`. Each file runs in its own
 * transaction. Run with `pnpm --filter @curanno/api migrate`, or call
 * `migrate()` from tests.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function listMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(dir + name, 'utf8') }));
}

export async function migrate(
  connectionString: string,
  dir = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    // Serialise concurrent runners (several API replicas starting at once).
    await client.query('select pg_advisory_lock(7245015)');
    try {
      const done = new Set(
        (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
          (r) => r.name,
        ),
      );
      for (const { name, sql } of listMigrations(dir)) {
        if (done.has(name)) {
          result.skipped.push(name);
          continue;
        }
        await client.query('begin');
        try {
          await client.query(sql);
          await client.query('insert into schema_migrations (name) values ($1)', [name]);
          await client.query('commit');
        } catch (err) {
          await client.query('rollback');
          throw new Error(`migration ${name} failed: ${(err as Error).message}`, { cause: err });
        }
        result.applied.push(name);
      }
    } finally {
      await client.query('select pg_advisory_unlock(7245015)');
    }
  } finally {
    await client.end();
  }
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const { applied, skipped } = await migrate(url);
  console.log(
    `applied ${applied.length} migration(s)${applied.length ? ': ' + applied.join(', ') : ''}; ${skipped.length} already applied`,
  );
}
