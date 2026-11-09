import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alice,
  annotationOn,
  bob,
  createTestContext,
  databaseUrl,
  ISSUER,
  type TestContext,
} from '../test/harness.js';
import { findAccount, HANDLING, MergeError, mergeAccounts } from './merge.js';

describe.skipIf(!databaseUrl)('merging accounts', () => {
  let ctx: TestContext;
  let survivor = '';
  let loser = '';
  let third = '';
  const ids: Record<string, string> = {};

  /** Every foreign key that points at a user or a principal, as `table.column`, from the database itself. */
  async function referencing(): Promise<string[]> {
    const rows = await sql<{ ref: string }>`
      select conrelid::regclass::text || '.' || a.attname as ref
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.contype = 'f' and c.confrelid in ('users'::regclass, 'principals'::regclass)`.execute(
      ctx.db,
    );
    return rows.rows.map((r) => r.ref).sort();
  }

  beforeAll(async () => {
    ctx = await createTestContext();
    const sid = await ctx.as(alice, { method: 'GET', url: '/x/me' });
    const lid = await ctx.as(bob, { method: 'GET', url: '/x/me' });
    survivor = sid.json<{ id: string }>().id;
    loser = lid.json<{ id: string }>().id;
    third = await rawUser('third');
  });
  afterAll(() => ctx.close());

  async function rawUser(name: string): Promise<string> {
    const p = await ctx.db
      .insertInto('principals')
      .values({ kind: 'user' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await ctx.db
      .insertInto('users')
      .values({ principal_id: p.id, issuer: ISSUER, subject: `raw-${name}`, display_name: name })
      .execute();
    await ctx.db
      .insertInto('identities')
      .values({ issuer: ISSUER, subject: `raw-${name}`, principal_id: p.id })
      .execute();
    return p.id;
  }
  const create = async (as: typeof alice, payload: object) => {
    const res = await ctx.as(as, { method: 'POST', url: '/annotations/', payload });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id.split('/').pop() as string;
  };
  const count = async (table: string, column: string, id: string): Promise<number> =>
    Number(
      (
        await sql<{
          n: string;
        }>`select count(*) as n from ${sql.table(table)} where ${sql.ref(column)} = ${id}`.execute(
          ctx.db,
        )
      ).rows[0]?.n,
    );

  /** One row per referencing column that points at the loser, so that nothing is merged on trust. */
  const fixtures: Record<string, () => Promise<void>> = {
    'identities.principal_id': () => Promise.resolve(), // made by signing in
    'linked_accounts.principal_id': async () => {
      await sql`insert into linked_accounts (provider, external_subject, principal_id) values ('oidc', 'ext-loser', ${loser})`.execute(
        ctx.db,
      );
    },
    'credentials.principal_id': async () => {
      await sql`insert into credentials (principal_id, login, password_hash) values (${loser}, 'loser-login', 'x'), (${survivor}, 'survivor-login', 'y')`.execute(
        ctx.db,
      );
    },
    'user_emails.principal_id': async () => {
      await sql`insert into user_emails (principal_id, email, verified_at) values
        (${loser}, 'loser-only@example.org', now()), (${loser}, 'Both@Example.org', null), (${survivor}, 'both@example.org', now())`.execute(
        ctx.db,
      );
    },
    'annotations.created_by': async () => {
      ids['a1'] = await create(bob, annotationOn('https://example.org/page-1', 'by the loser'));
    },
    'annotation_events.actor_id': () => Promise.resolve(), // made by creating annotations
    'acl.principal_id': async () => {
      ids['a2'] = await create(
        alice,
        annotationOn('https://example.org/page-2', 'by the survivor'),
      );
      ids['a3'] = await create(alice, annotationOn('https://example.org/page-3', 'both can read'));
      await sql`insert into acl (annotation_id, principal_id, permission) values
        (${ids['a2']}, ${loser}, 'read'), (${ids['a3']}, ${loser}, 'read'), (${ids['a3']}, ${survivor}, 'read')
        on conflict do nothing`.execute(ctx.db);
    },
    'acl.granted_by': async () => {
      await sql`update acl set granted_by = ${loser} where annotation_id = ${ids['a2']} and principal_id = ${loser}`.execute(
        ctx.db,
      );
    },
    'groups.created_by': async () => {
      const g = await ctx.db
        .insertInto('principals')
        .values({ kind: 'group' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.db
        .insertInto('groups')
        .values({ principal_id: g.id, name: 'Made by the loser', created_by: loser })
        .execute();
      ids['g3'] = g.id;
    },
    'group_memberships.user_id': async () => {
      for (const name of ['both', 'loser-only']) {
        const g = await ctx.db
          .insertInto('principals')
          .values({ kind: 'group' })
          .returning('id')
          .executeTakeFirstOrThrow();
        await ctx.db.insertInto('groups').values({ principal_id: g.id, name }).execute();
        ids[name] = g.id;
      }
      await sql`insert into group_memberships (group_id, user_id, role) values
        (${ids['both']}, ${loser}, 'admin'), (${ids['both']}, ${survivor}, 'member'), (${ids['loser-only']}, ${loser}, 'member')`.execute(
        ctx.db,
      );
    },
    'group_memberships.added_by': async () => {
      await sql`update group_memberships set added_by = ${loser} where group_id = ${ids['both']} and user_id = ${survivor}`.execute(
        ctx.db,
      );
    },
    'body_profiles.created_by': async () => {
      await sql`insert into body_profiles (iri, title, schema, created_by) values ('https://example.org/profile/1', 'P', '{}'::jsonb, ${loser})`.execute(
        ctx.db,
      );
    },
    'account_tokens.created_by': async () => {
      await sql`insert into account_tokens (token_hash, purpose, email, created_by, expires_at) values ('t1', 'invite', 'i@example.org', ${loser}, now() + interval '1 day')`.execute(
        ctx.db,
      );
    },
    'account_tokens.principal_id': async () => {
      await sql`insert into account_tokens (token_hash, purpose, email, principal_id, expires_at) values ('t2', 'reset', 'loser-only@example.org', ${loser}, now() + interval '1 day')`.execute(
        ctx.db,
      );
    },
    'auth_events.principal_id': async () => {
      await sql`insert into auth_events (kind, principal_id) values ('login', ${loser})`.execute(
        ctx.db,
      );
    },
    'applications.principal_id': async () => {
      await sql`insert into applications (principal_id) values (${loser})`.execute(ctx.db);
    },
    'applications.decided_by': async () => {
      await sql`insert into applications (principal_id, decision, decided_at, decided_by) values (${third}, 'approved', now(), ${loser})`.execute(
        ctx.db,
      );
    },
    'upstream_attempts.principal_id': async () => {
      await sql`insert into upstream_attempts (state_hash, provider, purpose, principal_id, nonce, code_verifier, binding_hash, expires_at)
        values ('s1', 'oidc', 'connect', ${loser}, 'n', 'v', 'b', now() + interval '1 hour')`.execute(
        ctx.db,
      );
    },
    'pending_links.principal_id': async () => {
      await sql`insert into pending_links (id_hash, provider, external_subject, email, principal_id, uid, binding_hash, expires_at)
        values ('p1', 'oidc', 'ext', 'loser-only@example.org', ${loser}, 'u', 'b', now() + interval '1 hour')`.execute(
        ctx.db,
      );
    },
    'login_tickets.principal_id': async () => {
      await sql`insert into login_tickets (ticket_hash, principal_id, uid, binding_hash, expires_at) values ('l1', ${loser}, 'u', 'b', now() + interval '1 hour')`.execute(
        ctx.db,
      );
    },
  };

  it('accounts for every column that references a user or a principal, and nothing else', async () => {
    expect(Object.keys(HANDLING).sort()).toEqual(await referencing());
    // Each that can hold the loser's rows has a fixture here, so each is exercised below.
    const exercisable = Object.entries(HANDLING)
      .filter(([, how]) => how !== 'self')
      .map(([k]) => k)
      .sort();
    expect(Object.keys(fixtures).sort()).toEqual(exercisable);
  });

  it('refuses to merge an account into itself or one that does not exist', async () => {
    await expect(mergeAccounts(ctx.db, survivor, survivor, null)).rejects.toThrow(MergeError);
    await expect(
      ctx.db
        .transaction()
        .execute((trx) =>
          mergeAccounts(trx, survivor, '00000000-0000-0000-0000-0000000000ff', null),
        ),
    ).rejects.toThrow(MergeError);
  });

  it('leaves nothing of the loser behind, and everything with the survivor', async () => {
    await ctx.db
      .updateTable('users')
      .set({ is_admin: true })
      .where('principal_id', '=', loser)
      .execute();
    for (const fixture of Object.values(fixtures)) await fixture();
    const before = Object.fromEntries(
      await Promise.all(
        Object.entries(HANDLING)
          .filter(([, how]) => how === 'moved')
          .map(async ([key]) => {
            const [table, column] = key.split('.') as [string, string];
            return [key, await count(table, column, loser)] as const;
          }),
      ),
    );
    // Every column the merge moves had something to move.
    for (const [key, n] of Object.entries(before)) expect(n, key).toBeGreaterThan(0);

    const result = await ctx.db
      .transaction()
      .execute((trx) => mergeAccounts(trx, survivor, loser, third));
    expect(result.annotations).toBe(1);

    for (const key of await referencing()) {
      const [table, column] = key.split('.') as [string, string];
      expect(await count(table, column, loser), `${key} still names the loser`).toBe(0);
    }
    for (const [key, n] of Object.entries(before)) {
      const [table, column] = key.split('.') as [string, string];
      expect(await count(table, column, survivor), key).toBeGreaterThanOrEqual(n);
    }
    expect(await count('users', 'principal_id', loser)).toBe(0);
    expect(await count('principals', 'id', loser)).toBe(0);
  });

  it('keeps what clashes sensibly: the survivor’s password, the stronger role, one copy of each permission and address', async () => {
    const creds = await ctx.db
      .selectFrom('credentials')
      .select(['login'])
      .where('principal_id', '=', survivor)
      .execute();
    expect(creds).toEqual([{ login: 'survivor-login' }]);
    const role = await ctx.db
      .selectFrom('group_memberships')
      .select('role')
      .where('group_id', '=', ids['both'] as string)
      .where('user_id', '=', survivor)
      .executeTakeFirstOrThrow();
    expect(role.role).toBe('admin');
    const only = await ctx.db
      .selectFrom('group_memberships')
      .select('user_id')
      .where('group_id', '=', ids['loser-only'] as string)
      .execute();
    expect(only).toEqual([{ user_id: survivor }]);
    const acl = await ctx.db
      .selectFrom('acl')
      .select('permission')
      .where('annotation_id', '=', ids['a3'] as string)
      .where('principal_id', '=', survivor)
      .where('permission', '=', 'read')
      .execute();
    expect(acl).toHaveLength(1);
    const emails = await ctx.db
      .selectFrom('user_emails')
      .select(['email', 'verified_at', 'is_primary'])
      .where('principal_id', '=', survivor)
      .orderBy('email')
      .execute();
    expect(
      emails.map((e) => [e.email.toLowerCase(), e.verified_at !== null, e.is_primary]),
    ).toEqual([
      ['both@example.org', true, false],
      ['loser-only@example.org', true, false],
    ]);
    const admin = await ctx.db
      .selectFrom('users')
      .select('is_admin')
      .where('principal_id', '=', survivor)
      .executeTakeFirstOrThrow();
    expect(admin.is_admin).toBe(true);
  });

  it('shows the survivor as the creator, tells watchers, and honours the loser’s old token as the survivor', async () => {
    const seen = await ctx.as(alice, { method: 'GET', url: `/annotations/${ids['a1']}` });
    expect(seen.statusCode).toBe(200);
    expect(seen.json<{ creator: { id: string } }>().creator.id).toContain(survivor);
    const events = await ctx.db
      .selectFrom('annotation_events')
      .select(['kind', 'actor_id'])
      .where('annotation_id', '=', ids['a1'] as string)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(events).toEqual({ kind: 'updated', actor_id: third });
    // The loser signed in as `bob`; that identity now leads to the survivor.
    const me = await ctx.as(bob, { method: 'GET', url: '/x/me' });
    expect(me.json<{ id: string }>().id).toBe(survivor);
    const audit = await ctx.db
      .selectFrom('auth_events')
      .select('detail')
      .where('kind', '=', 'accounts-merged')
      .executeTakeFirstOrThrow();
    expect(audit.detail).toContain(loser);
  });

  it('ends the loser’s sessions and finds accounts by id, login or verified address', async () => {
    const other = await rawUser('other');
    await sql`insert into oidc_store (id, type, payload) values ('sess', 'Session', ${JSON.stringify({ accountId: other })}::jsonb)`.execute(
      ctx.db,
    );
    await ctx.db.transaction().execute((trx) => mergeAccounts(trx, survivor, other, null));
    expect(await count('oidc_store', 'id', 'sess')).toBe(0);
    expect(await findAccount(ctx.db, survivor)).toBe(survivor);
    expect(await findAccount(ctx.db, 'Survivor-Login')).toBe(survivor);
    expect(await findAccount(ctx.db, 'LOSER-ONLY@example.org')).toBe(survivor);
    expect(await findAccount(ctx.db, 'nobody')).toBeUndefined();
  });
});
