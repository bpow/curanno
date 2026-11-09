/**
 * Limits on guessing, shared by every replica because the counts live in
 * Postgres (`auth_events`). A throttle names what it counts by a keyed hash,
 * so the table holds no login names or addresses, and a dump does not say
 * who was attacked. Limits are per login and per client address: the first
 * stops a guessing run against one account from anywhere, the second stops
 * one machine from trying many accounts. The address comes from the proxy's
 * forwarding header, which an attacker reaching the server directly could
 * forge; the per-login limit does not depend on it.
 */
import { createHmac } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { Problem } from '../../problems.js';

export interface Limit {
  /** What is counted: `login-failed`, `reset-requested`, … */
  kind: string;
  max: number;
  windowMs: number;
}

export const LIMITS = {
  loginPerLogin: { kind: 'login-failed', max: 10, windowMs: 15 * 60_000 },
  loginPerAddress: { kind: 'login-failed', max: 40, windowMs: 15 * 60_000 },
  resetPerEmail: { kind: 'reset-requested', max: 3, windowMs: 60 * 60_000 },
  resetPerAddress: { kind: 'reset-requested', max: 10, windowMs: 60 * 60_000 },
  verifyPerUser: { kind: 'verify-requested', max: 5, windowMs: 60 * 60_000 },
  tokenPerAddress: { kind: 'token-failed', max: 20, windowMs: 60 * 60_000 },
  signupPerAddress: { kind: 'signup', max: 5, windowMs: 60 * 60_000 },
  signupPerEmail: { kind: 'signup-email', max: 3, windowMs: 60 * 60_000 },
  passwordPerUser: { kind: 'password-failed', max: 10, windowMs: 15 * 60_000 },
} satisfies Record<string, Limit>;

export const RETENTION_MS = 90 * 24 * 3600_000;

export class Throttle {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly secret: string,
  ) {}

  /** The keyed hash stored in place of `value`. */
  key(scope: string, value: string): string {
    return createHmac('sha256', this.secret)
      .update(`throttle\0${scope}\0${value.trim().toLowerCase()}`)
      .digest('base64url');
  }

  /** Throws 429 when any of the counts is already at its limit. */
  async check(...counts: [Limit, string][]): Promise<void> {
    for (const [limit, key] of counts) {
      const since = new Date(Date.now() - limit.windowMs);
      const row = await this.db
        .selectFrom('auth_events')
        .select(sql<string>`count(*)`.as('n'))
        .where('kind', '=', limit.kind)
        .where('key', '=', key)
        .where('at', '>', since)
        .executeTakeFirstOrThrow();
      if (Number(row.n) >= limit.max) {
        throw new Problem(
          429,
          'Too Many Requests',
          'Too many attempts. Wait a while before trying again.',
          undefined,
          { 'retry-after': String(Math.ceil(limit.windowMs / 1000)) },
        );
      }
    }
  }

  /** Counts one event of `kind` against each key. */
  async record(
    kind: string,
    keys: (string | undefined)[],
    extra: { principalId?: string; detail?: string } = {},
  ): Promise<void> {
    const rows = keys.filter((k): k is string => k !== undefined);
    if (rows.length === 0) return;
    await this.db
      .insertInto('auth_events')
      .values(
        rows.map((key) => ({
          kind,
          key,
          principal_id: extra.principalId ?? null,
          detail: extra.detail ?? null,
        })),
      )
      .execute();
  }

  /** An event with nothing to count, kept as a record (a sign-in, a reset). */
  async note(kind: string, principalId: string | undefined, detail?: string): Promise<void> {
    await this.db
      .insertInto('auth_events')
      .values({ kind, principal_id: principalId ?? null, key: null, detail: detail ?? null })
      .execute();
  }
}

export async function purgeEvents(db: Kysely<Database>): Promise<number> {
  const result = await db
    .deleteFrom('auth_events')
    .where('at', '<', new Date(Date.now() - RETENTION_MS))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
