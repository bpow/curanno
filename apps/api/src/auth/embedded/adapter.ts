/**
 * oidc-provider's storage in Postgres (ADR 0028, migration 0013). The
 * provider hands it one JSON payload per artifact (session, grant, code,
 * refresh token, interaction) and looks them up by id, by `uid`, by user
 * code and by grant. Access tokens are JWTs and are never stored.
 */
import { sql, type Kysely } from 'kysely';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { Database } from '../../db/schema.js';

export function createAdapterClass(db: Kysely<Database>): new (name: string) => Adapter {
  return class PgAdapter implements Adapter {
    constructor(private readonly name: string) {}

    async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
      const row = {
        id,
        type: this.name,
        payload: JSON.stringify(payload),
        grant_id: payload.grantId ?? null,
        uid: payload.uid ?? null,
        user_code: payload.userCode ?? null,
        expires_at: expiresAt,
      };
      await db
        .insertInto('oidc_store')
        .values(row)
        .onConflict((oc) =>
          oc.columns(['id', 'type']).doUpdateSet({
            payload: row.payload,
            grant_id: row.grant_id,
            uid: row.uid,
            user_code: row.user_code,
            expires_at: row.expires_at,
          }),
        )
        .execute();
    }

    private async one(
      column: 'id' | 'uid' | 'user_code',
      value: string,
    ): Promise<AdapterPayload | undefined> {
      const row = await db
        .selectFrom('oidc_store')
        .select('payload')
        .where('type', '=', this.name)
        .where(column, '=', value)
        .where((eb) =>
          eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`now()`)]),
        )
        .executeTakeFirst();
      return row?.payload;
    }

    find(id: string): Promise<AdapterPayload | undefined> {
      return this.one('id', id);
    }

    findByUid(uid: string): Promise<AdapterPayload | undefined> {
      return this.one('uid', uid);
    }

    findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      return this.one('user_code', userCode);
    }

    async destroy(id: string): Promise<void> {
      await db
        .deleteFrom('oidc_store')
        .where('id', '=', id)
        .where('type', '=', this.name)
        .execute();
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      await db.deleteFrom('oidc_store').where('grant_id', '=', grantId).execute();
    }

    async consume(id: string): Promise<void> {
      await sql`update oidc_store
                   set payload = jsonb_set(payload, '{consumed}', to_jsonb(extract(epoch from now())::bigint))
                 where id = ${id} and type = ${this.name}`.execute(db);
    }
  };
}

/** Removes what has expired; the provider ignores it already, this keeps the table small. */
export async function purgeExpired(db: Kysely<Database>): Promise<number> {
  const result = await db
    .deleteFrom('oidc_store')
    .where('expires_at', '<', sql<Date>`now()`)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/**
 * Ends every session, grant and token of a user, so that a reset password
 * locks out whoever had the old one. Access tokens already issued stay valid
 * until they expire (at most an hour).
 */
export async function revokeSessions(db: Kysely<Database>, principalId: string): Promise<void> {
  await sql`delete from oidc_store where payload->>'accountId' = ${principalId}`.execute(db);
}
