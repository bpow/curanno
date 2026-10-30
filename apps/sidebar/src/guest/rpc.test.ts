import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseSidebarMessage,
  type GuestMessage,
  type Payload,
  type SidebarMessage,
} from '@scale/model';
import { afterEach, describe, expect, it } from 'vitest';
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

/**
 * A stand-in for the sidebar's window: `parent` records what the sidebar
 * posts up, `deliver` hands a window message to the sidebar as if from
 * `source` at `origin`. Port traffic uses a real `MessageChannel`.
 */
function sidebarWindow() {
  type Listener = (event: MessageEventLike) => void;
  const listeners = new Set<Listener>();
  const up: { data: unknown; targetOrigin: string }[] = [];
  const parent = {
    postMessage(data: unknown, targetOrigin: string) {
      up.push({ data, targetOrigin });
    },
  };
  const win: WindowLike = {
    parent,
    addEventListener: (_, l) => void listeners.add(l),
    removeEventListener: (_, l) => void listeners.delete(l),
  };
  return {
    win,
    parent,
    up,
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

async function connected() {
  const w = sidebarWindow();
  const guest = createRpcGuest({ window: w.win });
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
    expect(t.up).toEqual([{ data: envelope({ type: 'sidebar.ready' }), targetOrigin: '*' }]);
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
    port.send({ type: 'guest.hello', guestId: 'g1', capabilities: { highlights: 'overlay' } }, 2);
    port.send(
      { type: 'document.report', document: { uri: 'https://host-page.test/x', links: [] } },
      2,
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
    const t = await connected();
    t.port.send({ type: 'document.report', document: ARTICLE });
    const framed = guestPort();
    cleanups.push(() => framed.close());
    // The host relays the frame's connect with the frame's origin.
    t.deliver(
      envelope({ type: 'guest.connect', guestId: 'g2', frameOrigin: 'https://frames.test' }),
      { ports: [framed.transfer] },
    );
    framed.send({
      type: 'guest.hello',
      guestId: 'g2',
      capabilities: { highlights: 'css-highlight', role: 'sub' },
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

    // The frame goes away: the host says so, and its document and results go with it.
    t.deliver(envelope({ type: 'guest.disconnect', guestId: 'g2' }), {});
    await flush();
    expect(t.guest.documents.value).toEqual([ARTICLE]);
    expect([...t.guest.anchoring.value]).toEqual([['urn:page', 'anchored']]);
    expect(t.guest.guests.value.map((g) => g.id)).toEqual(['g1']);
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
