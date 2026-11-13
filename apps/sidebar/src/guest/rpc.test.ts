import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseSidebarMessage,
  type GuestMessage,
  type Payload,
  type SidebarMessage,
} from '@curanno/model';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionConsent } from './disclosure';
import { createRpcGuest, type MessageEventLike, type PortLike, type WindowLike } from './rpc';

const GUEST_ORIGIN = 'https://host-page.test';
const ARTICLE = {
  uri: 'https://host-page.test/article',
  title: 'An article',
  links: [{ uri: 'https://host-page.test/article', relation: 'self' as const }],
};
const FRAMED = {
  uri: 'https://frames.test/embedded',
  links: [{ uri: 'https://frames.test/embedded', relation: 'self' as const }],
};

/** A frame of the page: records what is posted to it; `closed` as a removed frame's window. */
interface FakeFrame {
  top: unknown;
  closed: boolean;
  length: number;
  inbox: { data: unknown; targetOrigin: string }[];
  postMessage(data: unknown, targetOrigin: string): void;
}

function fakeFrame(top: unknown): FakeFrame {
  const inbox: FakeFrame['inbox'] = [];
  return {
    top,
    closed: false,
    length: 0,
    inbox,
    postMessage: (data, targetOrigin) => void inbox.push({ data, targetOrigin }),
  };
}

/**
 * A stand-in for the sidebar's window: `parent` (the top page) records what
 * the sidebar posts up, `addFrame` gives the page a child frame, `deliver`
 * hands a window message to the sidebar as if from `source` at `origin`.
 * Port traffic uses a real `MessageChannel`.
 */
function sidebarWindow(options: { nested?: boolean } = {}) {
  type Listener = (event: MessageEventLike) => void;
  const listeners = new Set<Listener>();
  const up: { data: unknown; targetOrigin: string }[] = [];
  const parent: Record<number, FakeFrame> & {
    length: number;
    top: unknown;
    postMessage(data: unknown, targetOrigin: string): void;
  } = {
    length: 0,
    top: undefined,
    postMessage(data: unknown, targetOrigin: string) {
      up.push({ data, targetOrigin });
    },
  };
  parent.top = parent;
  // `nested`: the sidebar's parent is itself a frame of some other top page.
  const top = options.nested ? { length: 0, top: undefined, postMessage() {} } : parent;
  if (options.nested) parent.top = top;
  const win: WindowLike = {
    parent,
    top: top as unknown as WindowLike['top'],
    addEventListener: (_, l) => void listeners.add(l),
    removeEventListener: (_, l) => void listeners.delete(l),
  };
  return {
    win,
    parent,
    up,
    addFrame(): FakeFrame {
      const frame = fakeFrame(top);
      parent[parent.length] = frame;
      parent.length += 1;
      return frame;
    },
    deliver(data: unknown, options: { origin?: string; source?: unknown; ports?: PortLike[] }) {
      const event: MessageEventLike = {
        data,
        origin: options.origin ?? GUEST_ORIGIN,
        source: 'source' in options ? options.source : parent,
        ports: options.ports ?? [],
      };
      for (const l of listeners) l(event);
    },
  };
}

/** The guest's end of a port: records sidebar messages, sends guest ones. */
function guestPort() {
  const channel = new MessageChannel();
  const received: SidebarMessage[] = [];
  channel.port1.addEventListener('message', (event) => {
    const message = parseSidebarMessage(event.data);
    if (message) received.push(message);
  });
  channel.port1.start();
  return {
    received,
    /** The port to transfer to the sidebar. */
    transfer: channel.port2 as unknown as PortLike,
    send(message: Payload<GuestMessage>, version = RPC_PROTOCOL_VERSION) {
      channel.port1.postMessage({ ...envelope(message), version });
    },
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/** Ports deliver asynchronously; a round trip needs a few turns of the loop. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function connected(
  options: { announceIntervalMs?: number; consent?: ReturnType<typeof createSessionConsent> } = {},
) {
  const w = sidebarWindow();
  const guest = createRpcGuest({ window: w.win, consent: createSessionConsent(null), ...options });
  const port = guestPort();
  cleanups.push(
    () => guest.close(),
    () => port.close(),
  );
  w.deliver(envelope({ type: 'guest.connect', guestId: 'g1' }), { ports: [port.transfer] });
  port.send({ type: 'guest.hello', guestId: 'g1', capabilities: { highlights: 'css-highlight' } });
  await flush();
  return { ...w, guest, port };
}

describe('the RPC guest', () => {
  it('announces itself to the parent and answers guest.hello', async () => {
    const t = await connected();
    expect(t.up).toHaveLength(1);
    expect(t.up[0]?.targetOrigin).toBe('*');
    const ready = t.up[0]?.data as { instance: unknown };
    expect(ready).toEqual(envelope({ type: 'sidebar.ready', instance: ready.instance as string }));
    expect(typeof ready.instance).toBe('string');
    expect(t.port.received.map((m) => m.type)).toEqual(['sidebar.hello']);
    expect(t.guest.connected.value).toBe(true);
    expect(t.guest.guestOrigin.value).toBe(GUEST_ORIGIN);
  });

  it('takes the document, selection, anchoring results and hover state from the guest', async () => {
    const t = await connected();
    const document = {
      uri: 'https://host-page.test/article',
      title: 'An article',
      links: [{ uri: 'https://host-page.test/article', relation: 'self' as const }],
    };
    t.port.send({ type: 'document.report', document });
    t.guest.anchor([
      { id: 'urn:a1', target: 'https://host-page.test/article' },
      { id: 'urn:a2', target: 'https://host-page.test/article' },
    ]);
    t.port.send({
      type: 'anchoring.results',
      results: [
        { id: 'urn:a1', state: 'anchored', targets: [{ state: 'anchored' }] },
        { id: 'urn:a2', state: 'orphaned', targets: [{ state: 'orphaned', reason: 'gone' }] },
        { id: 'urn:never-asked', state: 'anchored', targets: [{ state: 'anchored' }] },
      ],
    });
    const selection = {
      quote: 'some words',
      target: {
        type: 'SpecificResource' as const,
        source: 'https://host-page.test/article',
        selector: { type: 'TextQuoteSelector' as const, exact: 'some words' },
      },
    };
    t.port.send({ type: 'selection.changed', selection });
    t.port.send({ type: 'highlights.hovered', ids: ['urn:a1'] });
    await flush();

    expect(t.guest.document.value).toEqual(document);
    expect(t.guest.documents.value).toEqual([document]);
    expect([...t.guest.anchoring.value]).toEqual([
      ['urn:a1', 'anchored'],
      ['urn:a2', 'orphaned'],
    ]);
    expect(t.guest.selection.value).toEqual({ ...selection, document });
    expect(t.guest.hovered.value).toEqual(['urn:a1']);
    expect(t.port.received.at(-1)).toMatchObject({
      type: 'annotations.anchor',
      requests: [{ id: 'urn:a1' }, { id: 'urn:a2' }],
    });

    t.port.send({ type: 'selection.changed', selection: null });
    await flush();
    expect(t.guest.selection.value).toBeUndefined();
  });

  it('maps the interface calls onto sidebar messages', async () => {
    const t = await connected();
    t.port.send({ type: 'document.report', document: ARTICLE });
    await flush();
    t.guest.anchor([{ id: 'urn:a1', target: 'https://host-page.test/article' }]);
    t.port.send({
      type: 'anchoring.results',
      results: [{ id: 'urn:a1', state: 'anchored', targets: [{ state: 'anchored' }] }],
    });
    await flush();
    t.guest.focus(['urn:a1']);
    t.guest.scrollTo('urn:a1');
    t.guest.clearSelection();
    t.guest.unanchor(['urn:a1']);
    await flush();
    expect(t.port.received.slice(1)).toEqual([
      envelope({
        type: 'annotations.anchor',
        requests: [{ id: 'urn:a1', target: 'https://host-page.test/article' }],
      }),
      envelope({ type: 'highlights.focus', ids: ['urn:a1'] }),
      envelope({ type: 'scroll.to', id: 'urn:a1' }),
      envelope({ type: 'selection.clear' }),
      envelope({ type: 'annotations.unanchor', ids: ['urn:a1'] }),
    ]);
    expect(t.guest.anchoring.value.size).toBe(0);
  });

  it('asks a guest that can report text for it, and takes only its answer', async () => {
    const t = await connected();
    expect(t.guest.textDocuments.value.size).toBe(0);
    // The default guest did not say it reports text.
    t.port.send({ type: 'document.report', document: ARTICLE });
    await flush();
    expect(await t.guest.requestText(ARTICLE.uri)).toBeUndefined();

    t.port.send({
      type: 'guest.hello',
      guestId: 'g1',
      capabilities: { highlights: 'css-highlight', text: true },
    });
    await flush();
    expect([...t.guest.textDocuments.value]).toEqual([ARTICLE.uri]);
    expect(await t.guest.requestText('https://host-page.test/other')).toBeUndefined();

    const answer = t.guest.requestText(ARTICLE.uri);
    await flush();
    const request = t.port.received.at(-1) as { type: string; requestId: string };
    expect(request.type).toBe('text.request');
    // A report for another request id is ignored.
    t.port.send({ type: 'text.report', requestId: 'other', scopes: [{ text: 'wrong' }] });
    t.port.send({
      type: 'text.report',
      requestId: request.requestId,
      scopes: [{ text: 'onetwo', blockStarts: [3] }],
    });
    expect(await answer).toEqual([{ text: 'onetwo', blockStarts: [3] }]);
  });

  it('gives up on a text request when the guest goes away or is silent', async () => {
    const t = await connected({ textTimeoutMs: 50 });
    t.port.send({
      type: 'guest.hello',
      guestId: 'g1',
      capabilities: { highlights: 'css-highlight', text: true },
    });
    t.port.send({ type: 'document.report', document: ARTICLE });
    await flush();
    await expect(t.guest.requestText(ARTICLE.uri)).rejects.toThrow(/did not report/);
    const pending = t.guest.requestText(ARTICLE.uri);
    t.guest.close();
    await expect(pending).rejects.toThrow(/went away/);
  });

  it('passes the suggested style through to the guest', async () => {
    const t = await connected();
    t.port.send({ type: 'document.report', document: ARTICLE });
    await flush();
    t.guest.anchor(
      [{ id: 'urn:uuid:s1', target: ARTICLE.uri, style: 'suggested', public: false }],
      ARTICLE.uri,
    );
    await flush();
    expect(t.port.received.at(-1)).toEqual(
      envelope({
        type: 'annotations.anchor',
        requests: [{ id: 'urn:uuid:s1', target: ARTICLE.uri, style: 'suggested' }],
      }),
    );
  });

  it('delivers highlight activations to subscribers until they unsubscribe', async () => {
    const t = await connected();
    const seen: string[][] = [];
    const off = t.guest.onActivate((ids) => seen.push(ids));
    t.port.send({ type: 'highlights.activated', ids: ['urn:a1'] });
    await flush();
    off();
    t.port.send({ type: 'highlights.activated', ids: ['urn:a2'] });
    await flush();
    expect(seen).toEqual([['urn:a1']]);
  });

  it('ignores a connect that is not from the parent window or has no port', async () => {
    const w = sidebarWindow();
    const guest = createRpcGuest({ window: w.win });
    const port = guestPort();
    cleanups.push(
      () => guest.close(),
      () => port.close(),
    );
    const connect = envelope({ type: 'guest.connect', guestId: 'g1' });
    w.deliver(connect, { source: { other: 'window' }, ports: [port.transfer] });
    w.deliver(connect, { ports: [] });
    w.deliver(envelope({ type: 'sidebar.ready' }), { ports: [port.transfer] });
    w.deliver({ type: 'guest.connect', guestId: 'g1' }, { ports: [port.transfer] });
    port.send({ type: 'guest.hello', guestId: 'g1', capabilities: { highlights: 'overlay' } });
    await flush();
    expect(guest.connected.value).toBe(false);
    expect(guest.guestOrigin.value).toBeUndefined();
    expect(port.received).toEqual([]);
  });

  it('answers an unknown protocol version with sidebar.error and takes nothing from it', async () => {
    const w = sidebarWindow();
    const guest = createRpcGuest({ window: w.win });
    cleanups.push(() => guest.close());

    const stale = guestPort();
    cleanups.push(() => stale.close());
    w.deliver(
      { ...envelope({ type: 'guest.connect', guestId: 'g0' }), version: 99 },
      { ports: [stale.transfer] },
    );
    await flush();
    expect(stale.received).toEqual([
      envelope({
        type: 'sidebar.error',
        message: 'unsupported protocol version 99',
        inReplyTo: 'guest.connect',
      }),
    ]);
    expect(guest.guestOrigin.value).toBeUndefined();

    const port = guestPort();
    cleanups.push(() => port.close());
    w.deliver(envelope({ type: 'guest.connect', guestId: 'g1' }), { ports: [port.transfer] });
    port.send({ type: 'guest.hello', guestId: 'g1', capabilities: { highlights: 'overlay' } }, 3);
    port.send(
      { type: 'document.report', document: { uri: 'https://host-page.test/x', links: [] } },
      3,
    );
    await flush();
    expect(port.received.map((m) => m.type)).toEqual(['sidebar.error', 'sidebar.error']);
    expect(guest.connected.value).toBe(false);
    expect(guest.document.value).toBeUndefined();
  });

  it('drops port messages before guest.hello and from an unknown shape', async () => {
    const w = sidebarWindow();
    const guest = createRpcGuest({ window: w.win });
    const port = guestPort();
    cleanups.push(
      () => guest.close(),
      () => port.close(),
    );
    w.deliver(envelope({ type: 'guest.connect', guestId: 'g1' }), { ports: [port.transfer] });
    port.send({ type: 'highlights.hovered', ids: ['urn:a1'] });
    port.send({ type: 'document.report', document: 'not a document' } as never);
    await flush();
    expect(guest.hovered.value).toEqual([]);
    expect(guest.document.value).toBeUndefined();
  });

  it('replaces the port on a repeated connect and re-sends the requests for its document', async () => {
    const t = await connected();
    t.port.send({ type: 'document.report', document: ARTICLE });
    await flush();
    t.guest.anchor([{ id: 'urn:a1', target: ARTICLE.uri }], ARTICLE.uri);
    t.port.send({
      type: 'anchoring.results',
      results: [{ id: 'urn:a1', state: 'anchored', targets: [{ state: 'anchored' }] }],
    });
    await flush();
    expect(t.guest.anchoring.value.get('urn:a1')).toBe('anchored');

    // The same guest id again: a reloaded frame.
    const next = guestPort();
    cleanups.push(() => next.close());
    t.deliver(envelope({ type: 'guest.connect', guestId: 'g1' }), { ports: [next.transfer] });
    expect(t.guest.connected.value).toBe(false);
    expect(t.guest.anchoring.value.size).toBe(0);
    expect(t.guest.documents.value).toEqual([]);
    next.send({ type: 'guest.hello', guestId: 'g1', capabilities: { highlights: 'overlay' } });
    next.send({ type: 'document.report', document: ARTICLE });
    await flush();
    expect(t.guest.connected.value).toBe(true);
    expect(next.received).toEqual([
      envelope({ type: 'sidebar.hello' }),
      envelope({
        type: 'annotations.anchor',
        requests: [{ id: 'urn:a1', target: ARTICLE.uri }],
      }),
    ]);

    // The old port is closed: nothing sent there arrives, and nothing is sent there.
    const before = t.port.received.length;
    t.guest.focus(['urn:a1']);
    t.port.send({ type: 'highlights.hovered', ids: ['urn:a1'] });
    await flush();
    expect(t.port.received).toHaveLength(before);
    expect(t.guest.hovered.value).toEqual([]);
  });

  it('refuses a document that is not on the guest origin, unless the origin is trusted', async () => {
    const t = await connected();
    t.port.send({
      type: 'document.report',
      document: { uri: 'https://victim.test/secret', links: [] },
    });
    t.port.send({ type: 'document.report', document: { uri: 'urn:x-pdf:abc', links: [] } });
    await flush();
    expect(t.guest.document.value).toBeUndefined();
    expect(t.port.received.filter((m) => m.type === 'sidebar.error')).toHaveLength(2);
    t.port.send({ type: 'document.report', document: ARTICLE });
    await flush();
    expect(t.guest.document.value).toEqual(ARTICLE);

    // The PDF viewer's origin may report the PDF it shows.
    const w = sidebarWindow();
    const viewer = createRpcGuest({ window: w.win, trustedOrigins: ['https://pdf.test'] });
    const port = guestPort();
    cleanups.push(
      () => viewer.close(),
      () => port.close(),
    );
    w.deliver(envelope({ type: 'guest.connect', guestId: 'v1' }), {
      origin: 'https://pdf.test',
      ports: [port.transfer],
    });
    port.send({
      type: 'guest.hello',
      guestId: 'v1',
      capabilities: { highlights: 'css-highlight' },
    });
    port.send({
      type: 'document.report',
      document: { uri: 'https://publisher.test/paper.pdf', links: [] },
    });
    await flush();
    expect(viewer.document.value?.uri).toBe('https://publisher.test/paper.pdf');
  });

  it('serves a guest in another frame alongside the host, each with its document', async () => {
    const t = await connected({ announceIntervalMs: 10 });
    t.port.send({ type: 'document.report', document: ARTICLE });
    const frame = t.addFrame();
    const framed = guestPort();
    cleanups.push(() => framed.close());
    // The frame's guest connects itself; its origin is the browser's.
    t.deliver(envelope({ type: 'guest.connect', guestId: 'g2' }), {
      origin: 'https://frames.test',
      source: frame,
      ports: [framed.transfer],
    });
    framed.send({
      type: 'guest.hello',
      guestId: 'g2',
      capabilities: { highlights: 'css-highlight' },
    });
    framed.send({ type: 'document.report', document: FRAMED });
    await flush();
    expect(t.guest.guests.value.map((g) => [g.id, g.role, g.origin])).toEqual([
      ['g1', 'host', GUEST_ORIGIN],
      ['g2', 'sub', 'https://frames.test'],
    ]);
    expect(t.guest.document.value).toEqual(ARTICLE);
    expect(t.guest.documents.value).toEqual([ARTICLE, FRAMED]);

    // Requests go to the guests showing the document; results merge by IRI.
    t.guest.anchor([{ id: 'urn:page', target: ARTICLE.uri }], ARTICLE.uri);
    t.guest.anchor([{ id: 'urn:frame', target: FRAMED.uri }], FRAMED.uri);
    await flush();
    expect(t.port.received.at(-1)).toMatchObject({
      type: 'annotations.anchor',
      requests: [{ id: 'urn:page' }],
    });
    expect(framed.received.at(-1)).toMatchObject({
      type: 'annotations.anchor',
      requests: [{ id: 'urn:frame' }],
    });
    framed.send({
      type: 'anchoring.results',
      results: [
        { id: 'urn:frame', state: 'orphaned', targets: [{ state: 'orphaned', reason: 'x' }] },
      ],
    });
    t.port.send({
      type: 'anchoring.results',
      results: [{ id: 'urn:page', state: 'anchored', targets: [{ state: 'anchored' }] }],
    });
    await flush();
    expect([...t.guest.anchoring.value]).toEqual([
      ['urn:page', 'anchored'],
      ['urn:frame', 'orphaned'],
    ]);

    // A selection in the frame carries the frame's document; scrolling goes to the right frame.
    framed.send({
      type: 'selection.changed',
      selection: {
        quote: 'framed words',
        target: {
          source: FRAMED.uri,
          selector: { type: 'TextQuoteSelector', exact: 'framed words' },
        },
      },
    });
    await flush();
    expect(t.guest.selection.value?.document).toEqual(FRAMED);
    t.guest.scrollTo('urn:frame');
    t.guest.clearSelection();
    await flush();
    expect(framed.received.slice(-2).map((m) => m.type)).toEqual(['scroll.to', 'selection.clear']);
    expect(t.port.received.some((m) => m.type === 'scroll.to')).toBe(false);

    // The frame goes away: its document and results go with it.
    frame.closed = true;
    await new Promise((r) => setTimeout(r, 30));
    expect(t.guest.documents.value).toEqual([ARTICLE]);
    expect([...t.guest.anchoring.value]).toEqual([['urn:page', 'anchored']]);
    expect(t.guest.guests.value.map((g) => g.id)).toEqual(['g1']);
  });

  it('announces itself to every frame of the page, at intervals, as one instance', async () => {
    const w = sidebarWindow();
    const frame = w.addFrame();
    const nested = fakeFrame(frame.top);
    (frame as unknown as Record<number, FakeFrame>)[0] = nested;
    frame.length = 1;
    const guest = createRpcGuest({ window: w.win, announceIntervalMs: 10 });
    cleanups.push(() => guest.close());
    await new Promise((r) => setTimeout(r, 35));
    const ready = w.up[0]?.data as { type: string; instance: unknown };
    expect(ready.type).toBe('sidebar.ready');
    expect(typeof ready.instance).toBe('string');
    for (const f of [frame, nested]) {
      expect(f.inbox.length).toBeGreaterThan(1);
      expect(f.inbox.every((m) => m.targetOrigin === '*')).toBe(true);
      expect(f.inbox.map((m) => m.data)).toEqual(f.inbox.map(() => ready));
    }
    // The parent hears it once; the page's own guest reconnects on every one it hears.
    expect(w.up).toHaveLength(1);
  });

  it("takes a guest's origin and role from the browser, not from what the page relays", async () => {
    const w = sidebarWindow();
    const guest = createRpcGuest({ window: w.win, trustedOrigins: ['https://pdf.test'] });
    cleanups.push(() => guest.close());
    // The page claims to relay frames of another origin, and of the viewer's.
    for (const [id, claimed] of [
      ['forged-victim', 'https://victim.test'],
      ['forged-viewer', 'https://pdf.test'],
    ] as const) {
      const port = guestPort();
      cleanups.push(() => port.close());
      w.deliver(envelope({ type: 'guest.connect', guestId: id, frameOrigin: claimed }), {
        ports: [port.transfer],
      });
      port.send({
        type: 'guest.hello',
        guestId: id,
        capabilities: { highlights: 'css-highlight', role: 'sub' } as never,
      });
      port.send({
        type: 'document.report',
        document: { uri: `${claimed}/private`, links: [] },
      });
      guest.anchor([{ id: 'urn:secret', target: `${claimed}/private` }], `${claimed}/private`);
      await flush();
      expect(guest.guests.value.map((g) => [g.id, g.role, g.origin])).toEqual([
        [id, 'host', GUEST_ORIGIN],
      ]);
      expect(guest.documents.value).toEqual([]);
      expect(port.received.map((m) => m.type)).toEqual(['sidebar.hello', 'sidebar.error']);
    }

    // A frame's guest cannot make itself the host.
    const frame = w.addFrame();
    const framed = guestPort();
    cleanups.push(() => framed.close());
    w.deliver(envelope({ type: 'guest.connect', guestId: 'g2' }), {
      origin: 'https://frames.test',
      source: frame,
      ports: [framed.transfer],
    });
    framed.send({
      type: 'guest.hello',
      guestId: 'g2',
      capabilities: { highlights: 'css-highlight', role: 'host' } as never,
    });
    await flush();
    expect(guest.guests.value.find((g) => g.id === 'g2')?.role).toBe('sub');
    expect(guest.guestOrigin.value).toBe(GUEST_ORIGIN);
  });

  it("refuses frames of another page, and serves no frames unless it is the top page's sidebar", async () => {
    const w = sidebarWindow();
    const guest = createRpcGuest({ window: w.win });
    const port = guestPort();
    cleanups.push(
      () => guest.close(),
      () => port.close(),
    );
    const elsewhere = fakeFrame({ length: 0 });
    w.deliver(envelope({ type: 'guest.connect', guestId: 'popup' }), {
      origin: 'https://popup.test',
      source: elsewhere,
      ports: [port.transfer],
    });
    await flush();
    expect(guest.guests.value).toEqual([]);

    const nested = sidebarWindow({ nested: true });
    const frame = nested.addFrame();
    const inner = createRpcGuest({ window: nested.win, announceIntervalMs: 10 });
    const framed = guestPort();
    cleanups.push(
      () => inner.close(),
      () => framed.close(),
    );
    nested.deliver(envelope({ type: 'guest.connect', guestId: 'g2' }), {
      origin: 'https://frames.test',
      source: frame,
      ports: [framed.transfer],
    });
    await new Promise((r) => setTimeout(r, 25));
    expect(inner.guests.value).toEqual([]);
    expect(frame.inbox).toEqual([]);
  });

  it('replaces the guest of a frame that connects again, as after a navigation', async () => {
    const t = await connected();
    const frame = t.addFrame();
    const ports = [guestPort(), guestPort()];
    cleanups.push(...ports.map((p) => () => p.close()));
    for (const [i, id] of ['before', 'after'].entries()) {
      t.deliver(envelope({ type: 'guest.connect', guestId: id }), {
        origin: 'https://frames.test',
        source: frame,
        ports: [ports[i]!.transfer],
      });
    }
    await flush();
    expect(t.guest.guests.value.map((g) => g.id)).toEqual(['g1', 'after']);
  });

  describe('disclosure (ADR 0025)', () => {
    const SECRET = 'Secret quote from the publisher';
    const own = { id: 'urn:own', target: ARTICLE.uri };
    const elsewhere = {
      id: 'urn:elsewhere',
      target: {
        type: 'SpecificResource',
        source: 'https://publisher.test/paper',
        selector: { type: 'TextQuoteSelector', exact: SECRET },
      },
    } as const;
    const anchored = (received: SidebarMessage[]) =>
      received
        .filter((m) => m.type === 'annotations.anchor')
        .flatMap((m) => (m.type === 'annotations.anchor' ? m.requests.map((r) => r.id) : []));

    it('withholds annotations made on another origin unless anyone may read them', async () => {
      const t = await connected();
      t.port.send({ type: 'document.report', document: ARTICLE });
      await flush();
      t.guest.anchor(
        [
          own,
          // http and https are one origin, as in document identity.
          { id: 'urn:http', target: 'http://host-page.test/article' },
          elsewhere,
          { id: 'urn:public', target: 'https://publisher.test/paper', public: true },
          { id: 'urn:pdf', target: 'urn:x-pdf:abc' },
        ],
        ARTICLE.uri,
      );
      await flush();
      expect(anchored(t.port.received)).toEqual(['urn:own', 'urn:http', 'urn:public']);
      expect(JSON.stringify(t.port.received)).not.toContain(SECRET);
      // The wire carries the protocol's request only.
      expect(JSON.stringify(t.port.received)).not.toContain('"public"');
      expect([...t.guest.withheld.value]).toEqual([
        ['urn:elsewhere', { pageOrigin: GUEST_ORIGIN, source: 'publisher.test' }],
        ['urn:pdf', { pageOrigin: GUEST_ORIGIN, source: 'urn:x-pdf:abc' }],
      ]);

      // Focus and scrolling name only what the page was sent.
      t.guest.focus(['urn:own', 'urn:elsewhere']);
      t.guest.scrollTo('urn:elsewhere');
      await flush();
      expect(t.port.received.at(-1)).toEqual(
        envelope({ type: 'highlights.focus', ids: ['urn:own'] }),
      );
    });

    it('sends what the user allowed, to pages on that origin, for the session', async () => {
      const consent = createSessionConsent(null);
      const t = await connected({ consent });
      t.port.send({ type: 'document.report', document: ARTICLE });
      const frame = t.addFrame();
      const framed = guestPort();
      cleanups.push(() => framed.close());
      t.deliver(envelope({ type: 'guest.connect', guestId: 'g2' }), {
        origin: 'https://frames.test',
        source: frame,
        ports: [framed.transfer],
      });
      framed.send({ type: 'guest.hello', guestId: 'g2', capabilities: { highlights: 'overlay' } });
      framed.send({ type: 'document.report', document: FRAMED });
      await flush();
      // Requests for every guest are held to the same rule, per guest.
      t.guest.anchor([own, elsewhere]);
      await flush();
      expect(anchored(t.port.received)).toEqual(['urn:own']);
      expect(anchored(framed.received)).toEqual([]);

      t.guest.allow(GUEST_ORIGIN, 'publisher.test');
      await flush();
      expect(anchored(t.port.received)).toEqual(['urn:own', 'urn:elsewhere']);
      expect(anchored(framed.received)).toEqual([]);
      expect(consent.has('host-page.test', 'publisher.test')).toBe(true);
      // The frame is still sent neither, but the host page shows both: nothing to offer.
      expect(t.guest.withheld.value.size).toBe(0);

      // A sidebar loaded later in the session remembers.
      const again = await connected({ consent });
      again.port.send({ type: 'document.report', document: ARTICLE });
      again.guest.anchor([elsewhere], ARTICLE.uri);
      await flush();
      expect(anchored(again.port.received)).toEqual(['urn:elsewhere']);
    });

    it('takes a highlight back when an annotation stops being public', async () => {
      const t = await connected();
      t.port.send({ type: 'document.report', document: ARTICLE });
      t.guest.anchor([{ ...elsewhere, public: true }], ARTICLE.uri);
      await flush();
      expect(anchored(t.port.received)).toEqual(['urn:elsewhere']);
      t.guest.anchor([elsewhere], ARTICLE.uri);
      await flush();
      expect(t.port.received.at(-1)).toEqual(
        envelope({ type: 'annotations.unanchor', ids: ['urn:elsewhere'] }),
      );
      expect(t.guest.withheld.value.has('urn:elsewhere')).toBe(true);
    });

    it('sends the trusted viewer what its PDF needs', async () => {
      const w = sidebarWindow();
      const viewer = createRpcGuest({
        window: w.win,
        trustedOrigins: ['https://pdf.test'],
        consent: createSessionConsent(null),
      });
      const port = guestPort();
      cleanups.push(
        () => viewer.close(),
        () => port.close(),
      );
      w.deliver(envelope({ type: 'guest.connect', guestId: 'v1' }), {
        origin: 'https://pdf.test',
        ports: [port.transfer],
      });
      port.send({ type: 'guest.hello', guestId: 'v1', capabilities: { highlights: 'overlay' } });
      port.send({
        type: 'document.report',
        document: { uri: 'https://publisher.test/paper', links: [] },
      });
      await flush();
      viewer.anchor([elsewhere], 'https://publisher.test/paper');
      await flush();
      expect(anchored(port.received)).toEqual(['urn:elsewhere']);
      expect(viewer.withheld.value.size).toBe(0);
    });
  });

  it('sends a guest the requests for its document when it reports it', async () => {
    const t = await connected();
    t.guest.anchor([{ id: 'urn:late', target: FRAMED.uri }], FRAMED.uri);
    t.guest.anchor([{ id: 'urn:page', target: ARTICLE.uri }], ARTICLE.uri);
    t.port.send({ type: 'document.report', document: ARTICLE });
    await flush();
    expect(t.port.received.filter((m) => m.type === 'annotations.anchor')).toEqual([
      envelope({ type: 'annotations.anchor', requests: [{ id: 'urn:page', target: ARTICLE.uri }] }),
    ]);
  });
});
