/**
 * Access tokens the API issues (ADR 0038): `cat_<id>_<secret>`, checked
 * against the database on every request, and limited by their scopes to
 * the operations those scopes name.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/index.js';
import { unauthorized } from '../problems.js';
import { groupsOf, principalsOf, type UserCaller } from './caller.js';

export const TOKEN_PREFIX = 'cat_';

const ANNOTATIONS_READ = [
  'GET /x/me',
  'GET /x/context.jsonld',
  'GET /x/profiles',
  'GET /x/profiles/:iri',
  'GET /x/ontologies',
  'GET /x/ontologies/:name/terms',
  'GET /x/documents',
  'GET /x/documents/:id',
  'GET /annotations/',
  'GET /annotations/:id',
  'GET /x/search',
  'GET /x/annotations/:id/acl',
  'GET /x/events',
];

/** The operations each scope allows, as `METHOD route`, in Fastify's route syntax. */
export const SCOPES: Record<string, readonly string[]> = {
  'suggestions:write': [
    'GET /x/me',
    // Public reads an engine needs: the profiles to fill, and ontology terms to resolve labels.
    'GET /x/profiles',
    'GET /x/ontologies/:name/terms',
    // IDs for suggestions, such as a case variant's (ADR 0039).
    'GET /x/resolve/:resolver',
    'POST /x/suggestion-batches',
    'GET /x/suggestion-batches',
    'GET /x/suggestion-batches/:id',
  ],
  'annotations:read': ANNOTATIONS_READ,
  // What the sidebar does to annotate: register the document, then create, edit or share.
  'annotations:write': [
    ...ANNOTATIONS_READ,
    'POST /x/documents',
    'POST /annotations/',
    'PUT /annotations/:id',
    'DELETE /annotations/:id',
    'PUT /x/annotations/:id/acl',
    'POST /x/annotations/:id/acl',
    'DELETE /x/annotations/:id/acl/:principalId/:permission',
  ],
};

/** How long `last_used_at` may lag behind, to save a write on every request. */
const LAST_USED_GRANULARITY = '1 minute';

const FORMAT = /^cat_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

const hashOf = (secret: string): string => createHash('sha256').update(secret).digest('hex');

const uuidOf = (hex: string): string =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** A new token's secret, what is stored of it, and the token to hand out once the id is known. */
export function newSecret(): { secretHash: string; tokenFor: (id: string) => string } {
  const secret = randomBytes(32).toString('base64url');
  return {
    secretHash: hashOf(secret),
    tokenFor: (id) => `${TOKEN_PREFIX}${id.replace(/-/g, '')}_${secret}`,
  };
}

/** The caller a token stands for; 401 for a token that is malformed, unknown, revoked or expired, or whose user may not act. */
export async function resolveToken(db: Kysely<Database>, token: string): Promise<UserCaller> {
  const match = FORMAT.exec(token);
  if (!match) throw unauthorized('the access token is malformed');
  const [, hex, secret] = match as unknown as [string, string, string];
  const id = uuidOf(hex);
  const row = await db
    .selectFrom('access_tokens')
    .innerJoin('users', 'users.principal_id', 'access_tokens.principal_id')
    .select([
      'access_tokens.secret_hash',
      'access_tokens.scopes',
      'access_tokens.expires_at',
      'access_tokens.revoked_at',
      'users.principal_id',
      'users.display_name',
      'users.is_admin',
      'users.status',
    ])
    .where('access_tokens.id', '=', id)
    .executeTakeFirst();
  const given = Buffer.from(hashOf(secret));
  const stored = Buffer.from(row?.secret_hash ?? '0'.repeat(64));
  const matches = given.length === stored.length && timingSafeEqual(given, stored);
  if (!row || !matches || row.revoked_at !== null || row.expires_at.getTime() <= Date.now()) {
    throw unauthorized('the access token is not valid');
  }
  if (row.status !== 'active') throw unauthorized('the access token belongs to an inactive user');
  await db
    .updateTable('access_tokens')
    .set({ last_used_at: sql`now()` })
    .where('id', '=', id)
    .where((eb) =>
      eb.or([
        eb('last_used_at', 'is', null),
        eb('last_used_at', '<', sql<Date>`now() - ${LAST_USED_GRANULARITY}::interval`),
      ]),
    )
    .execute();
  const groups = await groupsOf(db, row.principal_id);
  return {
    kind: 'user',
    userId: row.principal_id,
    displayName: row.display_name ?? undefined,
    // A token never carries administration, whoever it belongs to.
    isAdmin: false,
    status: row.status,
    principalIds: principalsOf(
      row.principal_id,
      groups.map((g) => g.group_id),
    ),
    expiresAt: row.expires_at.getTime(),
    token: { id, scopes: row.scopes },
  };
}

/** Whether a token with these scopes may make this request. */
export function scopesAllow(scopes: readonly string[], method: string, route: string | undefined) {
  if (route === undefined) return false;
  const operation = `${method} ${route}`;
  return scopes.some((s) => SCOPES[s]?.includes(operation));
}
