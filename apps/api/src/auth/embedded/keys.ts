/**
 * The issuer's signing keys, shared by every replica through the database
 * (ADR 0028). The newest key signs; every key that has not been retired is
 * published and verifies. A key is created the first time the issuer starts,
 * under an advisory lock so that replicas starting together make one.
 */
import { exportJWK, generateKeyPair, type JWK } from 'jose';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { seal, unseal } from './secrets.js';

const ALGORITHM = 'ES256';
const KEY_LOCK = 7245016;

export interface SigningKeys {
  /** Private keys, newest first, for the provider. */
  private: (JWK & { kid: string })[];
  /** The public halves of the same keys, for verifying tokens. */
  public: { keys: JWK[] };
}

export async function loadSigningKeys(db: Kysely<Database>, secret: string): Promise<SigningKeys> {
  let rows = await readKeys(db);
  if (rows.length === 0) {
    await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${KEY_LOCK})`.execute(trx);
      const again = await trx
        .selectFrom('signing_keys')
        .select('kid')
        .where('retired_at', 'is', null)
        .limit(1)
        .execute();
      if (again.length === 0) await insertKey(trx, secret);
    });
    rows = await readKeys(db);
  }
  const keys = rows.map((row) => ({
    ...(JSON.parse(unseal(secret, row.private_jwk_encrypted)) as JWK),
    kid: row.kid,
  }));
  return {
    private: keys,
    public: { keys: rows.map((row) => row.public_jwk as JWK) },
  };
}

/** Adds a key that signs from now on. The previous keys keep verifying until retired. */
export async function rotateSigningKey(db: Kysely<Database>, secret: string): Promise<string> {
  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${KEY_LOCK})`.execute(trx);
    return insertKey(trx, secret);
  });
}

/**
 * Keeps keys for an overlap period after rotation, allowing every replica
 * to restart and the tokens signed before that restart to expire.
 */
export async function retireOldKeys(db: Kysely<Database>, overlapMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - overlapMs);
  return db.transaction().execute(async (trx) => {
    // Rotation and retirement must agree on the newest key.
    await sql`select pg_advisory_xact_lock(${KEY_LOCK})`.execute(trx);
    const newest = await trx
      .selectFrom('signing_keys')
      .select(['kid', 'created_at'])
      .where('retired_at', 'is', null)
      .orderBy('created_at', 'desc')
      .orderBy('kid')
      .limit(1)
      .executeTakeFirst();
    // A key may have signed tokens until this rotation, however old the key itself is.
    if (!newest || newest.created_at >= cutoff) return 0;
    const result = await trx
      .updateTable('signing_keys')
      .set({ retired_at: new Date() })
      .where('retired_at', 'is', null)
      .where('kid', '!=', newest.kid)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  });
}

function readKeys(db: Kysely<Database>) {
  return db
    .selectFrom('signing_keys')
    .select(['kid', 'public_jwk', 'private_jwk_encrypted'])
    .where('retired_at', 'is', null)
    .orderBy('created_at', 'desc')
    .orderBy('kid')
    .execute();
}

async function insertKey(trx: Kysely<Database>, secret: string): Promise<string> {
  const { publicKey, privateKey } = await generateKeyPair(ALGORITHM, { extractable: true });
  const kid = crypto.randomUUID();
  const publicJwk = { ...(await exportJWK(publicKey)), kid, use: 'sig', alg: ALGORITHM };
  const privateJwk = { ...(await exportJWK(privateKey)), kid, use: 'sig', alg: ALGORITHM };
  await trx
    .insertInto('signing_keys')
    .values({
      kid,
      algorithm: ALGORITHM,
      public_jwk: JSON.stringify(publicJwk),
      private_jwk_encrypted: seal(secret, JSON.stringify(privateJwk)),
    })
    .execute();
  return kid;
}
