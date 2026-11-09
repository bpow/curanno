import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { AnnotationStore } from '../annotations/store.js';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import type { EventBridge } from '../events/bridge.js';
import type { Metrics } from '../metrics.js';
import type { ProfileService } from '../profiles/service.js';

/** Mail about accounts, available when the embedded issuer can send it. */
export interface AccountMail {
  decided(
    email: string,
    decision: 'approved' | 'rejected',
    note: string | undefined,
  ): Promise<void>;
}

export interface AppContext {
  db: Kysely<Database>;
  config: Config;
  store: AnnotationStore;
  profiles: ProfileService;
  bridge: EventBridge;
  metrics: Metrics;
  /** Interval between `: keepalive` comments on event streams. */
  keepaliveMs: number;
  /** Events fetched per query when an event stream replays from `Last-Event-ID`. */
  replayPageSize: number;
  accountMail?: AccountMail | undefined;
}

/** One handler per operationId; fastify-openapi-glue binds them by name (ADR 0011). */
export type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export type Handlers = Record<string, Handler>;

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Postgres unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
