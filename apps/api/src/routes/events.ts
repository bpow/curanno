/**
 * Server-sent events: the LISTEN/NOTIFY bridge fanned out to one HTTP
 * response per subscriber, each event checked against the subscriber's
 * read permission before it is written (ADR 0006).
 */
import { toAnnotation } from '../annotations/serialize.js';
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
      const caller = request.caller;
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

      const send = async (event: EventPayload): Promise<void> => {
        if (closed || event.id <= lastSent) return;
        if (filtered) {
          const wanted = await resolveDocument();
          if (wanted === undefined || event.document_id !== wanted) return;
        }
        if (!(await store.canRead(event.annotation_id, caller))) return;
        const data: Record<string, unknown> = { id: event.annotation_id };
        if (event.kind !== 'deleted') {
          const record = await store.get(event.annotation_id, caller);
          if (!record || record.deleted_at !== null) return;
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
      const keepalive = setInterval(() => {
        if (!closed) raw.write(': keepalive\n\n');
      }, ctx.keepaliveMs);
      request.raw.on('close', () => {
        closed = true;
        unsubscribe();
        clearInterval(keepalive);
      });

      if (lastEventId !== undefined) {
        let replay = db
          .selectFrom('annotation_events')
          .select(['id', 'annotation_id', 'document_id', 'kind'])
          .where('id', '>', lastEventId)
          .orderBy('id')
          .limit(REPLAY_LIMIT);
        if (filtered) replay = replay.where('document_id', '=', documentId ?? NIL_UUID);
        for (const row of await replay.execute()) deliver({ ...row, id: Number(row.id) });
      }
    },
  };
}
