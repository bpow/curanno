/**
 * Test fixture: a scratch database with the migrations applied, a server
 * whose token verifier trusts a key pair generated here, and a way to mint
 * tokens for made-up users. Needs DATABASE_URL; tests that use it skip
 * without one.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import pg from 'pg';
import { createTokenVerifier } from '../auth/verifier.js';
import type { Config } from '../config.js';
import { createDb, migrate, type Database } from '../db/index.js';
import type { Kysely } from 'kysely';
import { buildServer } from '../server.js';

export const ISSUER = 'https://idp.test';
export const CLIENT_ID = 'curanno-sidebar';
export const PUBLIC_URL = 'https://annotations.test';

export interface TestUser {
  sub: string;
  name?: string;
  email?: string;
}

export const alice: TestUser = { sub: 'alice', name: 'Alice Annotator' };
export const bob: TestUser = { sub: 'bob', name: 'Bob Reviewer' };
export const carol: TestUser = { sub: 'carol', name: 'Carol Curator' };
export const root: TestUser = { sub: 'root', name: 'Root' };

export interface TestContext {
  app: FastifyInstance;
  db: Kysely<Database>;
  config: Config;
  token(user: TestUser, options?: { expiresIn?: string }): Promise<string>;
  /** `app.inject` with a bearer token for `user`, or anonymous when `user` is null. */
  as(user: TestUser | null, options: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export const databaseUrl = process.env['DATABASE_URL'];

export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.href;
}

/**
 * Drops a scratch database once nothing is connected to it. `pg.Pool.end()`
 * resolves before its clients' sockets close, so dropping with FORCE right
 * away can terminate a backend whose client is still ending; the client
 * then emits an error nobody listens for and the test run fails. FORCE
 * stays as the backstop for a connection that never leaves.
 */
export async function dropDatabase(admin: pg.Client, name: string): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const result = await admin.query<{ n: string }>(
      'select count(*)::text as n from pg_stat_activity where datname = $1',
      [name],
    );
    if (result.rows[0]?.n === '0' || Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await admin.query(`drop database if exists ${name} with (force)`);
}

export interface TestContextOptions {
  keepaliveMs?: number;
  replayPageSize?: number;
  /** Serving the clients, the viewer origin, metrics: overrides of the test configuration. */
  config?: Partial<
    Pick<Config, 'staticRoot' | 'frameAncestors' | 'pdfViewerOrigin' | 'metricsEnabled'>
  >;
  /**
   * Run against this database as it is (already migrated, say a restored
   * backup) instead of a scratch one; it is not dropped at `close()`.
   */
  existingDatabaseUrl?: string;
}

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const dbName = `curanno_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  let testUrl: string;
  if (options.existingDatabaseUrl) {
    testUrl = options.existingDatabaseUrl;
  } else {
    await admin.query(`create database ${dbName}`);
    testUrl = withDatabase(databaseUrl, dbName);
    await migrate(testUrl);
  }

  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' };
  const config: Config = {
    databaseUrl: testUrl,
    auth: {
      mode: 'external',
      secret: undefined,
      extraOrigins: [],
      smtpUrl: undefined,
      mailFrom: undefined,
      bootstrapAdminEmail: undefined,
    },
    oidc: { issuer: ISSUER, clientId: CLIENT_ID, audience: CLIENT_ID },
    port: 0,
    publicUrl: PUBLIC_URL,
    logLevel: 'silent',
    staticRoot: undefined,
    frameAncestors: ["'self'"],
    pdfViewerOrigin: undefined,
    metricsEnabled: true,
    ...options.config,
  };
  const db = createDb(testUrl);
  const app = await buildServer({
    config,
    db,
    verifyToken: createTokenVerifier({ ...config.oidc, jwks: createLocalJWKSet({ keys: [jwk] }) }),
    keepaliveMs: options.keepaliveMs ?? 30_000,
    ...(options.replayPageSize !== undefined ? { replayPageSize: options.replayPageSize } : {}),
    authCacheMs: 0,
  });
  await app.ready();

  const token = (user: TestUser, options: { expiresIn?: string } = {}): Promise<string> =>
    new SignJWT({
      ...(user.name ? { name: user.name } : {}),
      ...(user.email ? { email: user.email } : {}),
      azp: CLIENT_ID,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer(ISSUER)
      .setSubject(user.sub)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '1h')
      .sign(privateKey);

  return {
    app,
    db,
    config,
    token,
    async as(user, injectOptions) {
      const headers = { ...(injectOptions.headers as Record<string, string> | undefined) };
      if (user) headers['authorization'] = `Bearer ${await token(user)}`;
      return app.inject({ ...injectOptions, headers });
    },
    async close() {
      await app.close();
      await db.destroy();
      if (!options.existingDatabaseUrl) await dropDatabase(admin, dbName);
      await admin.end();
    },
  };
}

/**
 * Creates a group directly in the database with the given members, standing
 * in for whatever provisioning a deployment uses (groups are managed
 * entirely through the API; ADR 0026). Each member must already have signed
 * in at least once.
 */
export async function createGroup(
  ctx: TestContext,
  name: string,
  members: TestUser[] = [],
): Promise<string> {
  const principal = await ctx.db
    .insertInto('principals')
    .values({ kind: 'group' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.db.insertInto('groups').values({ principal_id: principal.id, name }).execute();
  for (const member of members) {
    const user = await ctx.db
      .selectFrom('identities')
      .select('principal_id')
      .where('issuer', '=', ISSUER)
      .where('subject', '=', member.sub)
      .executeTakeFirstOrThrow();
    await ctx.db
      .insertInto('group_memberships')
      .values({ group_id: principal.id, user_id: user.principal_id })
      .execute();
  }
  return principal.id;
}

/** A minimal annotation input on `source` with a quote, as the sidebar would send it. */
export function annotationOn(
  source: string,
  text = 'A comment',
  extra: Record<string, unknown> = {},
) {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    type: 'Annotation',
    motivation: 'commenting',
    body: { type: 'TextualBody', value: text, purpose: 'commenting', format: 'text/plain' },
    target: {
      type: 'SpecificResource',
      source,
      selector: [
        { type: 'TextQuoteSelector', exact: 'quoted words', prefix: 'some ', suffix: ' here' },
        { type: 'TextPositionSelector', start: 5, end: 17 },
      ],
    },
    ...extra,
  };
}
