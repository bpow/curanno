/**
 * Server-sent events over LISTEN/NOTIFY: two subscribers with different
 * permissions see different events, and Last-Event-ID replays what a
 * subscriber missed, in pages and before live events. Runs against a listening server because the stream
 * never ends.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_PRINCIPAL_ID } from '../db/index.js';
import {
  alice,
  annotationOn,
  bob,
  createGroup,
  createTestContext,
  databaseUrl,
  type TestContext,
  type TestUser,
} from '../test/harness.js';

const PAGE = 'https://example.org/live';
const LD_JSON = { 'content-type': 'application/ld+json' };

interface SseEvent {
  event: string;
  id: string;
  data: { id: string; annotation?: { body?: { value: string } } };
}

interface Stream {
  next(timeoutMs?: number): Promise<SseEvent>;
  expectSilence(ms: number): Promise<void>;
  /** Ids of id-only blocks: events the server skipped for this subscriber. */
  skipped: string[];
  /** Resolves when the server ends the response. */
  ended: Promise<void>;
  close(): void;
}

async function openStream(
  base: string,
  path: string,
  token: string | undefined,
  lastEventId?: string,
): Promise<Stream> {
  const controller = new AbortController();
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (lastEventId) headers['last-event-id'] = lastEventId;
  const res = await fetch(base + path, { headers, signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const queue: SseEvent[] = [];
  const waiters: ((e: SseEvent) => void)[] = [];
  const skipped: string[] = [];
  let buffer = '';
  let onEnd: () => void = () => undefined;
  const ended = new Promise<void>((resolve) => {
    onEnd = resolve;
  });
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (block.startsWith(':')) continue;
          const fields: Record<string, string> = {};
          for (const line of block.split('\n')) {
            const colon = line.indexOf(':');
            fields[line.slice(0, colon)] = line.slice(colon + 1).trimStart();
          }
          if (fields['data'] === undefined) {
            if (fields['id'] !== undefined) skipped.push(fields['id']);
            continue;
          }
          const event: SseEvent = {
            event: fields['event'] ?? 'message',
            id: fields['id'] ?? '',
            data: JSON.parse(fields['data'] ?? '{}') as SseEvent['data'],
          };
          const waiter = waiters.shift();
          if (waiter) waiter(event);
          else queue.push(event);
        }
      }
    } catch {
      // closed
    } finally {
      onEnd();
    }
  })();
  return {
    skipped,
    ended,
    next(timeoutMs = 5000) {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise<SseEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no event arrived')), timeoutMs);
        waiters.push((e) => {
          clearTimeout(timer);
          resolve(e);
        });
      });
    },
    async expectSilence(ms) {
      await new Promise((r) => setTimeout(r, ms));
      expect(queue).toEqual([]);
    },
    close() {
      controller.abort();
    },
  };
}

describe.skipIf(!databaseUrl)('events', () => {
  let ctx: TestContext;
  let base: string;
  const streams: Stream[] = [];

  async function create(user: TestUser, text: string, grantPublic = false) {
    const res = await ctx.as(user, {
      method: 'POST',
      url: '/annotations/',
      headers: LD_JSON,
      payload: annotationOn(PAGE, text),
    });
    expect(res.statusCode).toBe(201);
    const iri = res.json<{ id: string }>().id;
    const id = iri.split('/').pop() as string;
    if (grantPublic) {
      const grant = await ctx.as(user, {
        method: 'POST',
        url: `/x/annotations/${id}/acl`,
        payload: { principal: PUBLIC_PRINCIPAL_ID, permission: 'read' },
      });
      expect(grant.statusCode).toBe(201);
    }
    return { id, etag: res.headers['etag'] as string };
  }

  beforeAll(async () => {
    // Small replay pages, so a replay of a few events takes several.
    ctx = await createTestContext({ keepaliveMs: 200, replayPageSize: 2 });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const address = ctx.app.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    base = `http://127.0.0.1:${address.port}`;
    // Log everybody in once so that users exist, then put bob in a group.
    await ctx.as(alice, { method: 'GET', url: '/x/me' });
    await ctx.as(bob, { method: 'GET', url: '/x/me' });
    await createGroup(ctx, 'reviewers', [bob]);
  });
  afterAll(async () => {
    for (const s of streams) s.close();
    await ctx.close();
  });

  it('delivers only the events each subscriber may read', async () => {
    const path = `/x/events?uri=${encodeURIComponent(PAGE)}`;
    const asAlice = await openStream(base, path, await ctx.token(alice));
    const asBob = await openStream(base, path, await ctx.token(bob));
    const anonymous = await openStream(base, path, undefined);
    streams.push(asAlice, asBob, anonymous);

    const secret = await create(alice, 'alice only');
    const aliceEvent = await asAlice.next();
    expect(aliceEvent.event).toBe('annotation.created');
    expect(aliceEvent.data.id).toBe(secret.id);
    expect(aliceEvent.data.annotation?.body?.value).toBe('alice only');

    const shared = await create(alice, 'for everyone', true);
    // The creation (private) is invisible to bob; the ACL change makes it an update he can see.
    expect((await asAlice.next()).event).toBe('annotation.created');
    expect((await asAlice.next()).event).toBe('annotation.updated');
    const bobEvent = await asBob.next();
    expect(bobEvent.event).toBe('annotation.updated');
    expect(bobEvent.data.id).toBe(shared.id);
    const anonEvent = await anonymous.next();
    expect(anonEvent.data.id).toBe(shared.id);

    const deleted = await ctx.as(alice, {
      method: 'DELETE',
      url: `/annotations/${shared.id}`,
      headers: { 'if-match': '*' },
    });
    expect(deleted.statusCode).toBe(204);
    const gone = await asBob.next();
    expect(gone.event).toBe('annotation.deleted');
    expect(gone.data).toEqual({ id: shared.id });
    expect((await asAlice.next()).event).toBe('annotation.deleted');
    expect((await anonymous.next()).event).toBe('annotation.deleted');

    await asBob.expectSilence(300);
    await anonymous.expectSilence(100);
    // The private creation was skipped for bob and the public: their ids moved on regardless.
    expect(asBob.skipped.length).toBeGreaterThan(0);
    expect(anonymous.skipped.length).toBeGreaterThan(0);
    expect(asAlice.skipped).toEqual([]);
  });

  it('stops delivering to a subscriber whose membership is withdrawn, and ends at token expiry', async () => {
    const path = `/x/events?uri=${encodeURIComponent(PAGE)}`;
    const asBob = await openStream(base, path, await ctx.token(bob));
    streams.push(asBob);
    const reviewers = await ctx.db
      .selectFrom('groups')
      .select('principal_id')
      .where('name', '=', 'reviewers')
      .executeTakeFirstOrThrow();
    const shared = await create(alice, 'for reviewers');
    const grant = await ctx.as(alice, {
      method: 'POST',
      url: `/x/annotations/${shared.id}/acl`,
      payload: { principal: reviewers.principal_id, permission: 'read' },
    });
    expect(grant.statusCode).toBe(201);
    expect((await asBob.next()).data.id).toBe(shared.id);

    // Bob is removed from the group; the stream learns at its next
    // keepalive (200 ms here) and skips the edit.
    await ctx.db
      .deleteFrom('group_memberships')
      .where('group_id', '=', reviewers.principal_id)
      .execute();
    await new Promise((r) => setTimeout(r, 500));
    const before = asBob.skipped.length;
    const edited = await ctx.as(alice, {
      method: 'PUT',
      url: `/annotations/${shared.id}`,
      headers: { ...LD_JSON, 'if-match': shared.etag },
      payload: annotationOn(PAGE, 'for reviewers, revised'),
    });
    expect(edited.statusCode).toBe(200);
    await asBob.expectSilence(400);
    expect(asBob.skipped.length).toBeGreaterThan(before);

    // A stream outlives its token by one keepalive at most.
    const shortLived = await openStream(base, path, await ctx.token(alice, { expiresIn: '1s' }));
    streams.push(shortLived);
    await Promise.race([
      shortLived.ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error('stream did not end')), 3000)),
    ]);
  });

  it('ignores other documents and replays from Last-Event-ID', async () => {
    const elsewhere = await openStream(
      base,
      `/x/events?uri=${encodeURIComponent('https://example.org/other')}`,
      await ctx.token(alice),
    );
    streams.push(elsewhere);
    const first = await create(alice, 'first', true);
    const all = await openStream(base, '/x/events', await ctx.token(alice));
    streams.push(all);
    await create(alice, 'second', true);
    const seen = await all.next();
    expect(seen.data.annotation?.body?.value).toBe('second');
    await elsewhere.expectSilence(300);

    // A subscriber that missed everything since `first` was created gets it replayed.
    const createdEvent = await ctx.db
      .selectFrom('annotation_events')
      .select('id')
      .where('annotation_id', '=', first.id)
      .orderBy('id')
      .executeTakeFirstOrThrow();
    const late = await openStream(
      base,
      `/x/events?uri=${encodeURIComponent(PAGE)}`,
      await ctx.token(bob),
      String(createdEvent.id),
    );
    streams.push(late);
    const replayed = await late.next();
    expect(replayed.event).toBe('annotation.updated');
    expect(replayed.data.id).toBe(first.id);
    expect(Number(replayed.id)).toBeGreaterThan(Number(createdEvent.id));
    const replayedToo = await late.next();
    expect(replayedToo.data.annotation?.body?.value).toBe('second');
  });

  /** The newest event id so far, and the events after it once `make` has run. */
  async function eventsAfter(make: () => Promise<unknown>) {
    const before = await ctx.db
      .selectFrom('annotation_events')
      .select((eb) => eb.fn.max('id').as('id'))
      .executeTakeFirstOrThrow();
    const from = Number(before.id ?? 0);
    await make();
    const rows = await ctx.db
      .selectFrom('annotation_events')
      .selectAll()
      .where('id', '>', String(from) as never)
      .orderBy('id')
      .execute();
    return { from, events: rows.map((r) => ({ ...r, id: Number(r.id) })) };
  }

  async function collect(stream: Stream, n: number): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(Number((await stream.next()).id));
    return ids;
  }

  it('replays every missed event, page after page, then delivers live ones', async () => {
    const { from, events } = await eventsAfter(async () => {
      for (const text of ['r1', 'r2', 'r3', 'r4', 'r5']) await create(alice, text);
    });
    expect(events).toHaveLength(5);
    const stream = await openStream(
      base,
      `/x/events?uri=${encodeURIComponent(PAGE)}`,
      await ctx.token(alice),
      String(from),
    );
    streams.push(stream);
    expect(await collect(stream, 5)).toEqual(events.map((e) => e.id));
    // The replay ends with its window's newest id, and live events follow it.
    const live = await create(alice, 'r6');
    const next = await stream.next();
    expect(next.data.id).toBe(live.id);
    await stream.expectSilence(200);
  });

  it('holds a live event that arrives during the replay until the replay is done', async () => {
    const { from, events } = await eventsAfter(async () => {
      for (const text of ['h1', 'h2', 'h3', 'h4']) await create(alice, text);
    });
    const latest = events.at(-1) as (typeof events)[number];
    let stream: Stream | undefined;
    // The replay waits on this lock; meanwhile the newest event's notification
    // arrives, as it would for an event created during the catch-up.
    await ctx.db.transaction().execute(async (trx) => {
      await sql`lock table annotation_events in access exclusive mode`.execute(trx);
      stream = await openStream(
        base,
        `/x/events?uri=${encodeURIComponent(PAGE)}`,
        await ctx.token(alice),
        String(from),
      );
      const deadline = Date.now() + 5000;
      for (;;) {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`.execute(ctx.db);
        if ((rows[0]?.n ?? 0) >= 1) break;
        if (Date.now() > deadline) throw new Error('the replay never waited for the lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const payload = JSON.stringify({
        id: latest.id,
        annotation_id: latest.annotation_id,
        document_id: latest.document_id,
        kind: latest.kind,
      });
      await sql`select pg_notify('annotation_events', ${payload})`.execute(ctx.db);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const held = stream as Stream;
    streams.push(held);
    expect(await collect(held, 4)).toEqual(events.map((e) => e.id));
    await held.expectSilence(200);
  });
});
