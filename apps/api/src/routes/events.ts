/**
 * Server-sent events: the LISTEN/NOTIFY bridge fanned out to one HTTP
 * response per subscriber, each event checked against the subscriber's
 * read permission before it is written (ADR 0006). A stream can stay open
 * for hours, so the subscriber's memberships are reloaded at each keepalive
 * and the stream ends when their token expires (security review, finding
 * 3); an event the subscriber may not see still advances the stream's id,
 * so a reconnecting client never replays the same window twice.
 */
import { hasPermission } from '../annotations/store.js';
import { toAnnotation } from '../annotations/serialize.js';
import { refreshCaller } from '../auth/caller.js';
import { findDocumentIdByUri } from '../documents/service.js';
import type { EventPayload } from '../events/bridge.js';
import { NIL_UUID, type AppContext, type Handlers } from './context.js';

interface EventsQuery {
  uri?: string;
  document?: string;
}

/** Events replayed for a `Last-Event-ID` in one go; clients reconnect for more. */
const REPLAY_LIMIT = 1000;

export function eventHandlers(ctx: AppContext): Handlers {
  const { db, store, bridge, config } = ctx;
  return {
    async streamEvents(request, reply) {
      const query = request.query as EventsQuery;
      let caller = request.caller;
      // A page's document may not exist yet when a sidebar subscribes; the
      // URI is resolved again on each event until it does.
      const filtered = query.document !== undefined || query.uri !== undefined;
      let documentId = query.document;
      const resolveDocument = async (): Promise<string | undefined> => {
        if (documentId === undefined && query.uri !== undefined) {
          documentId = await findDocumentIdByUri(db, query.uri);
        }
        return documentId;
      };
      await resolveDocument();
      const lastHeader = request.headers['last-event-id'];
      const lastEventId =
        typeof lastHeader === 'string' && /^\d+$/.test(lastHeader) ? Number(lastHeader) : undefined;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      raw.write(': connected\n\n');

      let closed = false;
      let lastSent = lastEventId ?? 0;
      let queue: Promise<void> = Promise.resolve();

      /** An id-only block: the client's Last-Event-ID moves on without an event. */
      const skip = (event: EventPayload): void => {
        if (closed) return;
        lastSent = event.id;
        raw.write(`id: ${event.id}\n\n`);
      };
      const send = async (event: EventPayload): Promise<void> => {
        if (closed || event.id <= lastSent) return;
        if (filtered) {
          const wanted = await resolveDocument();
          if (wanted === undefined || event.document_id !== wanted) return;
        }
        if (!(await store.canRead(event.annotation_id, caller))) return skip(event);
        const data: Record<string, unknown> = { id: event.annotation_id };
        if (event.kind !== 'deleted') {
          const record = await store.get(event.annotation_id, caller);
          if (!record || record.deleted_at !== null) return skip(event);
          data['annotation'] = toAnnotation(record, config.publicUrl);
        }
        if (closed) return;
        lastSent = event.id;
        raw.write(
          `event: annotation.${event.kind}\nid: ${event.id}\ndata: ${JSON.stringify(data)}\n\n`,
        );
      };
      const deliver = (event: EventPayload): void => {
        queue = queue
          .then(() => send(event))
          .catch((err: unknown) => request.log.error({ err }, 'event delivery failed'));
      };

      const unsubscribe = bridge.subscribe(deliver);
      const end = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(keepalive);
        raw.end();
      };
      /** At each keepalive: the token's expiry ends the stream, and permissions are reloaded. */
      const keepalive = setInterval(() => {
        if (closed) return;
        if (caller.kind === 'user') {
          if (caller.expiresAt !== undefined && caller.expiresAt <= Date.now()) return end();
          queue = queue
            .then(async () => {
              if (caller.kind !== 'user') return;
              const fresh = await refreshCaller(db, caller);
              if (!fresh) return end();
              caller = fresh;
            })
            .catch((err: unknown) => request.log.error({ err }, 'caller refresh failed'));
        }
        raw.write(': keepalive\n\n');
      }, ctx.keepaliveMs);
      request.raw.on('close', end);

      if (lastEventId !== undefined) {
        // Only events the subscriber may read are fetched; the newest id in
        // the window is sent as an id-only block so the client moves past
        // the rest, instead of asking for the same window again.
        let replay = db
          .selectFrom('annotation_events')
          .innerJoin('annotations', 'annotations.id', 'annotation_events.annotation_id')
          .select([
            'annotation_events.id',
            'annotation_events.annotation_id',
            'annotation_events.document_id',
            'annotation_events.kind',
          ])
          .where('annotation_events.id', '>', lastEventId)
          .where(hasPermission(caller.principalIds, 'read'))
          .orderBy('annotation_events.id')
          .limit(REPLAY_LIMIT);
        let newest = db
          .selectFrom('annotation_events')
          .select((eb) => eb.fn.max('id').as('id'))
          .where('id', '>', lastEventId);
        if (filtered) {
          replay = replay.where('annotation_events.document_id', '=', documentId ?? NIL_UUID);
          newest = newest.where('document_id', '=', documentId ?? NIL_UUID);
        }
        const rows = await replay.execute();
        for (const row of rows) deliver({ ...row, id: Number(row.id) });
        if (rows.length < REPLAY_LIMIT) {
          const last = await newest.executeTakeFirst();
          const id = last?.id === null || last?.id === undefined ? undefined : Number(last.id);
          if (id !== undefined) {
            queue = queue.then(() => {
              if (!closed && id > lastSent) {
                lastSent = id;
                raw.write(`id: ${id}\n\n`);
              }
            });
          }
        }
      }
    },
  };
}
