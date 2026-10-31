/**
 * Server-sent events: the LISTEN/NOTIFY bridge fanned out to one HTTP
 * response per subscriber, each event checked against the subscriber's
 * read permission before it is written (ADR 0006). A stream can stay open
 * for hours, so the subscriber's memberships are reloaded at each keepalive
 * and the stream ends when their token expires (security review, finding
 * 3); an event the subscriber may not see still advances the stream's id,
 * so a reconnecting client never replays the same window twice. A replay
 * runs to the end in pages before any live event is written, so a live
 * event cannot carry the stream past events not yet replayed (code review
 * of 2026-10-30, finding 6). A live event's own read check is pinned to
 * when it occurred, not whatever the ACL holds when the check happens to
 * run, so a grant landing moments later cannot retroactively make an
 * earlier event visible that it was not at the time (security review,
 * finding 24).
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

export function eventHandlers(ctx: AppContext): Handlers {
  const { db, store, bridge, config, metrics, replayPageSize } = ctx;
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
      metrics.eventStreams.inc();

      let closed = false;
      let lastSent = lastEventId ?? 0;
      let queue: Promise<void> = Promise.resolve();

      /** An id-only block: the client's Last-Event-ID moves on without an event. */
      const skip = (event: EventPayload): void => {
        if (closed) return;
        lastSent = event.id;
        raw.write(`id: ${event.id}\n\n`);
      };
      const write = (event: EventPayload, data: Record<string, unknown>): void => {
        lastSent = event.id;
        raw.write(
          `event: annotation.${event.kind}\nid: ${event.id}\ndata: ${JSON.stringify(data)}\n\n`,
        );
        metrics.eventsDelivered.inc({ kind: event.kind });
      };
      const send = async (event: EventPayload): Promise<void> => {
        if (closed || event.id <= lastSent) return;
        if (filtered) {
          const wanted = await resolveDocument();
          if (wanted === undefined || event.document_id !== wanted) return;
        }
        if (!(await store.couldHaveRead(event.annotation_id, caller, event.occurred_at))) {
          return skip(event);
        }
        const data: Record<string, unknown> = { id: event.annotation_id };
        if (event.kind !== 'deleted') {
          const record = await store.get(event.annotation_id, caller);
          if (!record || record.deleted_at !== null) return skip(event);
          data['annotation'] = toAnnotation(record, config.publicUrl);
        }
        if (closed) return;
        write(event, data);
      };
      /**
       * Replayed events passed the document filter and the ACL in the
       * replay query, so their annotations are loaded in one query rather
       * than two per event (docs/performance.md).
       */
      const sendReplayed = async (events: EventPayload[]): Promise<void> => {
        const ids = events.filter((e) => e.kind !== 'deleted').map((e) => e.annotation_id);
        const records = await store.getMany([...new Set(ids)], caller);
        for (const event of events) {
          if (closed) return;
          if (event.id <= lastSent) continue;
          const data: Record<string, unknown> = { id: event.annotation_id };
          if (event.kind !== 'deleted') {
            const record = records.get(event.annotation_id);
            if (!record || record.deleted_at !== null) {
              skip(event);
              continue;
            }
            data['annotation'] = toAnnotation(record, config.publicUrl);
          }
          write(event, data);
        }
      };
      const deliver = (event: EventPayload): void => {
        queue = queue
          .then(() => send(event))
          .catch((err: unknown) => request.log.error({ err }, 'event delivery failed'));
      };

      /**
       * Replays the window after `after` that existed when the replay began:
       * its newest id is read first, then only the events the subscriber may
       * read are fetched, a page at a time, up to it. That id is then sent as
       * an id-only block so the client moves past the rest instead of asking
       * for the same window again. Later events arrive live.
       */
      const replay = async (after: number): Promise<void> => {
        let newest = db
          .selectFrom('annotation_events')
          .select((eb) => eb.fn.max('id').as('id'))
          .where('id', '>', after);
        if (filtered) newest = newest.where('document_id', '=', documentId ?? NIL_UUID);
        const last = await newest.executeTakeFirst();
        if (last?.id === null || last?.id === undefined) return;
        const bound = Number(last.id);
        let cursor = after;
        while (!closed) {
          let page = db
            .selectFrom('annotation_events')
            .innerJoin('annotations', 'annotations.id', 'annotation_events.annotation_id')
            .select([
              'annotation_events.id',
              'annotation_events.annotation_id',
              'annotation_events.document_id',
              'annotation_events.kind',
              'annotation_events.occurred_at',
            ])
            .where('annotation_events.id', '>', cursor)
            .where('annotation_events.id', '<=', bound)
            .where(hasPermission(caller.principalIds, 'read'))
            .orderBy('annotation_events.id')
            .limit(replayPageSize);
          if (filtered) {
            page = page.where('annotation_events.document_id', '=', documentId ?? NIL_UUID);
          }
          const events = (await page.execute()).map((row) => ({
            ...row,
            id: Number(row.id),
            occurred_at: row.occurred_at.toISOString(),
          }));
          await sendReplayed(events);
          const lastRow = events.at(-1);
          if (events.length < replayPageSize || lastRow === undefined) break;
          cursor = lastRow.id;
        }
        if (!closed && bound > lastSent) {
          lastSent = bound;
          raw.write(`id: ${bound}\n\n`);
        }
      };

      const unsubscribe = bridge.subscribe(deliver);
      // Queued in the same turn as the subscription, so every live event
      // waits behind the whole replay; one that falls in the window is then
      // dropped as already sent.
      if (lastEventId !== undefined) {
        queue = queue
          .then(() => replay(lastEventId))
          .catch((err: unknown) => request.log.error({ err }, 'event replay failed'));
      }
      const end = (): void => {
        if (closed) return;
        closed = true;
        metrics.eventStreams.dec();
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
    },
  };
}
