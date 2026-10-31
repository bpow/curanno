import type { Annotation } from '@curanno/api-client';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeApi, json, type Call } from '../test/fake-api';
import { useAnnotationsStore } from './annotations';

const PAGE = 'https://example.org/page';

function annotation(n: number, text = 'A note'): Annotation {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: `https://annotations.test/annotations/${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`,
    type: 'Annotation',
    created: '2026-10-31T08:00:00Z',
    body: { type: 'TextualBody', value: text },
    target: PAGE,
  };
}

/** An event stream the test writes to, as the server would. */
function openEventStream() {
  const encoder = new TextEncoder();
  let push: (text: string) => void = () => undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(encoder.encode(text));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  return {
    response,
    created(a: Annotation, id: number) {
      push(
        `event: annotation.created\nid: ${id}\ndata: ${JSON.stringify({ id: a.id.split('/').pop(), annotation: a })}\n\n`,
      );
    },
  };
}

/** A response whose body arrives when the test says so. */
function delayed(body: unknown) {
  let send: () => void = () => undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        send = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
          controller.close();
        };
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  return { response, send };
}

describe('annotations store across sessions', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("drops what an earlier session's stream delivers and subscribes again", async () => {
    const streams: ReturnType<typeof openEventStream>[] = [];
    const api = installFakeApi(({ url }) => {
      if (url.pathname === '/x/search') return json({ total: 0, items: [] });
      if (url.pathname === '/x/events') {
        const stream = openEventStream();
        streams.push(stream);
        return stream.response;
      }
      return undefined;
    });
    const events = (): Call[] => api.calls.filter((c) => c.url.pathname === '/x/events');
    const store = useAnnotationsStore();
    await store.load([PAGE]);
    store.startLive([PAGE]);
    await flushPromises();
    const signedIn = streams[0];
    signedIn?.created(annotation(1, 'private'), 1);
    await flushPromises();
    expect(store.items.size).toBe(1);

    // Signing out: the stream opened with the old token is aborted, and
    // what still arrives on it is ignored.
    store.resetSession();
    expect(events()[0]?.signal.aborted).toBe(true);
    expect(store.items.size).toBe(0);
    signedIn?.created(annotation(2, 'private too'), 2);
    await flushPromises();
    expect(store.items.size).toBe(0);

    // The new session gets a stream of its own.
    expect(await store.load([PAGE])).toBe(true);
    store.startLive([PAGE]);
    await flushPromises();
    expect(events()).toHaveLength(2);
    expect(events()[1]?.signal.aborted).toBe(false);
  });

  it("drops an earlier session's search and write that return after the reset", async () => {
    const search = delayed({ total: 1, items: [annotation(1, 'private')] });
    const created = delayed(annotation(2, 'mine'));
    installFakeApi(({ url, method }) => {
      if (url.pathname === '/x/search') return search.response;
      if (method === 'POST' && url.pathname === '/annotations/') return created.response;
      return undefined;
    });
    const store = useAnnotationsStore();
    const loading = store.load([PAGE]);
    const creating = store.create({ target: PAGE } as never, PAGE);
    await flushPromises();
    store.resetSession();
    search.send();
    created.send();
    expect(await loading).toBe(false);
    await creating;
    expect(store.items.size).toBe(0);
    expect(store.problem).toBeUndefined();
  });
});
