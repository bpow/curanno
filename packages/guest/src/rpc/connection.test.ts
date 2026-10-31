import {
  RPC_PROTOCOL_VERSION,
  envelope,
  type SidebarMessage,
  type SidebarReadyMessage,
} from '@curanno/model';
import { describe, expect, it, vi } from 'vitest';
import { GuestConnection } from './connection.js';
import { FakeSidebar } from './fake-sidebar.js';

const READY = envelope<SidebarReadyMessage>({ type: 'sidebar.ready', instance: 'one' });

/**
 * A pair of fake windows: `page` is where the guest runs, `frame` the
 * sidebar iframe. Window messages are routed by hand so the test controls
 * origin and source; port messages use Node's MessageChannel.
 */
function windows(sidebarOrigin = 'https://sidebar.test') {
  type Handler = (event: { data: unknown; origin: string; source: unknown }) => void;
  const pageHandlers = new Set<Handler>();
  const frameInbox: { data: unknown; origin: string; ports: unknown[] }[] = [];
  const frame = {
    postMessage(data: unknown, origin: string, transfer: unknown[] = []) {
      frameInbox.push({ data, origin, ports: transfer });
    },
  };
  const page = {
    addEventListener(_: 'message', h: Handler) {
      pageHandlers.add(h);
    },
    removeEventListener(_: 'message', h: Handler) {
      pageHandlers.delete(h);
    },
    /** Deliver a window message to the page as if from `source` at `origin`. */
    deliver(data: unknown, origin = sidebarOrigin, source: unknown = frame) {
      for (const h of pageHandlers) h({ data, origin, source });
    },
  };
  return { page, frame, frameInbox, sidebarOrigin };
}

function connect(received: SidebarMessage[] = []) {
  const w = windows();
  const connected = vi.fn();
  const connection = new GuestConnection({
    window: w.page as unknown as Window,
    sidebarWindow: () => w.frame as unknown as Window,
    sidebarOrigin: w.sidebarOrigin,
    guestId: 'g1',
    capabilities: { highlights: 'css-highlight' },
    onMessage: (m) => received.push(m),
    onConnected: connected,
    createChannel: () => new MessageChannel(),
  });
  return { ...w, connection, connected, received };
}

/** Ports deliver asynchronously; a round trip needs a few turns of the loop. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('GuestConnection', () => {
  it('connects on sidebar.ready from the sidebar frame at the sidebar origin', async () => {
    const t = connect();
    t.page.deliver(READY);
    expect(t.frameInbox).toHaveLength(1);
    const [sent] = t.frameInbox;
    expect(sent?.origin).toBe(t.sidebarOrigin);
    expect(sent?.data).toMatchObject({ type: 'guest.connect', guestId: 'g1' });
    expect(FakeSidebar.isConnect(sent?.data)).toBe(true);

    const sidebar = new FakeSidebar();
    sidebar.attach(sent?.ports[0] as MessagePort);
    await flush();
    expect(sidebar.guestId).toBe('g1');
    expect(t.connection.connected).toBe(true);
    expect(t.connected).toHaveBeenCalledTimes(1);

    sidebar.focus(['urn:a']);
    await flush();
    expect(t.received).toEqual([
      expect.objectContaining({ type: 'highlights.focus', ids: ['urn:a'] }),
    ]);
    t.connection.close();
  });

  it('ignores sidebar.ready from another origin, another source or without the envelope', () => {
    const t = connect();
    t.page.deliver(READY, 'https://evil.test');
    t.page.deliver(READY, t.sidebarOrigin, {});
    t.page.deliver({ type: 'sidebar.ready' });
    t.page.deliver(envelope({ type: 'sidebar.hello' }));
    expect(t.frameInbox).toHaveLength(0);
    t.connection.close();
  });

  it('drops messages until sidebar.hello and ignores malformed ones', async () => {
    const t = connect();
    t.page.deliver(READY);
    const port = t.frameInbox[0]?.ports[0] as MessagePort;
    const sidebar = new FakeSidebar({ autoHello: false });
    sidebar.attach(port);
    sidebar.focus(['early']);
    port.postMessage(envelope({ type: 'scroll.to', id: 42 }));
    port.postMessage({ type: 'highlights.focus', ids: ['no-envelope'] });
    await flush();
    expect(t.received).toEqual([]);
    expect(t.connection.send({ type: 'highlights.hovered', ids: [] })).toBe(false);
    sidebar.hello();
    await flush();
    expect(t.connection.send({ type: 'highlights.hovered', ids: ['urn:b'] })).toBe(true);
    await flush();
    expect(sidebar.hovered).toEqual(['urn:b']);
    t.connection.close();
    port.close();
  });

  it('reconnects on a second sidebar.ready and rejects unknown versions', async () => {
    const t = connect();
    t.page.deliver(READY);
    const first = new FakeSidebar();
    first.attach(t.frameInbox[0]?.ports[0] as MessagePort);
    await flush();
    expect(t.connection.connected).toBe(true);

    t.page.deliver(READY);
    expect(t.connection.connected).toBe(false);
    const second = new FakeSidebar();
    second.attach(t.frameInbox[1]?.ports[0] as MessagePort);
    await flush();
    expect(t.connection.connected).toBe(true);
    expect(t.connected).toHaveBeenCalledTimes(2);

    const port = t.frameInbox[1]?.ports[0] as MessagePort;
    const errors: unknown[] = [];
    port.addEventListener('message', (e) => {
      if ((e.data as { type: string }).type === 'guest.error') errors.push(e.data);
    });
    port.postMessage({ ...envelope({ type: 'sidebar.hello' }), version: RPC_PROTOCOL_VERSION + 1 });
    await flush();
    expect(errors).toEqual([expect.objectContaining({ type: 'guest.error' })]);
    t.connection.close();
    port.close();
  });
});
