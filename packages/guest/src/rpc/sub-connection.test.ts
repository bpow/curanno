import {
  envelope,
  parseGuestMessage,
  type GuestMessage,
  type SidebarMessage,
  type SidebarReadyMessage,
} from '@curanno/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubGuestConnection } from './sub-connection.js';

const SIDEBAR_ORIGIN = 'https://sidebar.test';
const ready = (instance: string) =>
  envelope<SidebarReadyMessage>({ type: 'sidebar.ready', instance });

type Handler = (event: {
  data: unknown;
  origin: string;
  source: unknown;
  ports: readonly unknown[];
}) => void;

/** A window with a message listener list and an inbox of what was posted to it. */
function fakeWindow(top?: unknown) {
  const handlers = new Set<Handler>();
  const inbox: { data: unknown; origin: string; ports: unknown[] }[] = [];
  const win = {
    top: undefined as unknown,
    addEventListener(_: 'message', h: Handler) {
      handlers.add(h);
    },
    removeEventListener(_: 'message', h: Handler) {
      handlers.delete(h);
    },
    postMessage(data: unknown, origin: string, transfer: unknown[] = []) {
      inbox.push({ data, origin, ports: transfer });
    },
    deliver(data: unknown, origin: string, source: unknown) {
      for (const h of handlers) h({ data, origin, source, ports: [] });
    },
    inbox,
  };
  win.top = top ?? win;
  return win;
}

/** The sidebar's end of the port the guest sent, recording guest messages. */
function sidebarEnd(port: unknown) {
  const received: GuestMessage[] = [];
  const p = port as MessagePort;
  p.addEventListener('message', (e) => {
    const m = parseGuestMessage(e.data);
    if (m) received.push(m);
  });
  p.start();
  return { port: p, received };
}

/** Ports deliver asynchronously; a round trip needs a few turns of the loop. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function setup() {
  const top = fakeWindow();
  const child = fakeWindow(top);
  const sidebar = fakeWindow(top);
  const received: SidebarMessage[] = [];
  const connected = vi.fn();
  const connection = new SubGuestConnection({
    window: child as unknown as Window,
    sidebarOrigin: SIDEBAR_ORIGIN,
    guestId: 'g2',
    capabilities: { highlights: 'css-highlight' },
    onMessage: (m) => received.push(m),
    onConnected: connected,
  });
  cleanups.push(
    () => connection.close(),
    () => {
      for (const entry of sidebar.inbox)
        for (const port of entry.ports) (port as MessagePort).close();
    },
  );
  return { top, child, sidebar, connection, received, connected };
}

describe('SubGuestConnection', () => {
  it('sends nothing to the page around it, only to the sidebar that announced itself', async () => {
    const t = setup();
    expect(t.top.inbox).toEqual([]);

    t.child.deliver(ready('one'), SIDEBAR_ORIGIN, t.sidebar);
    expect(t.top.inbox).toEqual([]);
    expect(t.sidebar.inbox).toHaveLength(1);
    const [sent] = t.sidebar.inbox;
    // Addressed to the sidebar origin: the browser delivers it to no other window.
    expect(sent?.origin).toBe(SIDEBAR_ORIGIN);
    expect(sent?.data).toEqual(envelope({ type: 'guest.connect', guestId: 'g2' }));
    expect(sent?.ports).toHaveLength(1);

    const sidebar = sidebarEnd(sent?.ports[0]);
    await flush();
    expect(sidebar.received).toEqual([
      envelope({
        type: 'guest.hello',
        guestId: 'g2',
        capabilities: { highlights: 'css-highlight' },
      }),
    ]);
    expect(t.connection.send({ type: 'highlights.hovered', ids: [] })).toBe(false);
    sidebar.port.postMessage(envelope({ type: 'sidebar.hello' }));
    await flush();
    expect(t.connected).toHaveBeenCalledTimes(1);
    expect(t.connection.connected).toBe(true);
    sidebar.port.postMessage(envelope({ type: 'highlights.focus', ids: ['urn:a'] }));
    await flush();
    expect(t.received).toEqual([envelope({ type: 'highlights.focus', ids: ['urn:a'] })]);
  });

  it('ignores sidebar.ready from another origin, another page or without the envelope', () => {
    const t = setup();
    // The page around the frame, or any other window, posing as the sidebar.
    t.child.deliver(ready('one'), 'https://page.test', t.top);
    t.child.deliver(ready('one'), 'https://evil.test', t.sidebar);
    // A sidebar-origin window that is not a frame of this page, such as an opener.
    t.child.deliver(ready('one'), SIDEBAR_ORIGIN, fakeWindow());
    t.child.deliver({ type: 'sidebar.ready', instance: 'one' }, SIDEBAR_ORIGIN, t.sidebar);
    t.child.deliver(envelope({ type: 'sidebar.ready' }), SIDEBAR_ORIGIN, t.sidebar);
    t.child.deliver({ ...ready('one'), version: 1 }, SIDEBAR_ORIGIN, t.sidebar);
    expect(t.sidebar.inbox).toEqual([]);
    expect(t.top.inbox).toEqual([]);
  });

  it('ignores repeats of the same sidebar and connects again when it reloads', async () => {
    const t = setup();
    t.child.deliver(ready('one'), SIDEBAR_ORIGIN, t.sidebar);
    const first = sidebarEnd(t.sidebar.inbox[0]?.ports[0]);
    first.port.postMessage(envelope({ type: 'sidebar.hello' }));
    await flush();
    expect(t.connection.connected).toBe(true);

    t.child.deliver(ready('one'), SIDEBAR_ORIGIN, t.sidebar);
    expect(t.sidebar.inbox).toHaveLength(1);
    expect(t.connection.connected).toBe(true);

    t.child.deliver(ready('two'), SIDEBAR_ORIGIN, t.sidebar);
    expect(t.sidebar.inbox).toHaveLength(2);
    expect(t.connection.connected).toBe(false);
    const second = sidebarEnd(t.sidebar.inbox[1]?.ports[0]);
    second.port.postMessage(envelope({ type: 'sidebar.hello' }));
    await flush();
    expect(t.connection.connected).toBe(true);
    // The first port was closed: a message on it reaches nothing.
    first.port.postMessage(envelope({ type: 'highlights.focus', ids: ['stale'] }));
    await flush();
    expect(t.received).toEqual([]);
  });
});
