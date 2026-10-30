import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseGuestMessage,
  type GuestMessage,
  type SidebarMessage,
} from '@curanno/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Host, type FrameWindowLike } from './host.js';
import { SubGuestConnection } from './sub-connection.js';

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
    closed: false,
    top: undefined as unknown,
    frames: [] as unknown[],
    addEventListener(_: 'message', h: Handler) {
      handlers.add(h);
    },
    removeEventListener(_: 'message', h: Handler) {
      handlers.delete(h);
    },
    postMessage(data: unknown, origin: string, transfer: unknown[] = []) {
      inbox.push({ data, origin, ports: transfer });
    },
    deliver(data: unknown, origin: string, source: unknown, ports: unknown[] = []) {
      for (const h of handlers) h({ data, origin, source, ports });
    },
    inbox,
  };
  win.top = top ?? win;
  return win;
}

/** Ports deliver asynchronously; a round trip needs a few turns of the loop. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const c of cleanups.splice(0)) c();
});

describe('Host', () => {
  it('relays a port between a child frame and the sidebar, with the frame origin', () => {
    const top = fakeWindow();
    const sidebar = fakeWindow(top);
    const child = fakeWindow(top);
    const host = new Host({
      window: top as unknown as Window,
      sidebarWindow: () => sidebar as unknown as Window,
      sidebarOrigin: 'https://sidebar.test',
      sidebarReady: () => true,
      createChannel: () => new MessageChannel(),
    });
    cleanups.push(() => host.close());
    top.deliver(envelope({ type: 'guest.discover', guestId: 'g2' }), 'https://frame.test', child);
    expect(sidebar.inbox).toEqual([
      {
        data: envelope({ type: 'guest.connect', guestId: 'g2', frameOrigin: 'https://frame.test' }),
        origin: 'https://sidebar.test',
        ports: [expect.any(MessagePort)],
      },
    ]);
    expect(child.inbox).toEqual([
      {
        data: envelope({ type: 'host.port', guestId: 'g2' }),
        origin: 'https://frame.test',
        ports: [expect.any(MessagePort)],
      },
    ]);
    expect(host.guestIds).toEqual(['g2']);
    (sidebar.inbox[0]?.ports[0] as MessagePort).close();
    (child.inbox[0]?.ports[0] as MessagePort).close();
  });

  it('ignores discovery from windows outside the page and while the sidebar is not ready', () => {
    const top = fakeWindow();
    const sidebar = fakeWindow(top);
    const popup = fakeWindow(); // its own top
    let ready = false;
    const host = new Host({
      window: top as unknown as Window,
      sidebarWindow: () => sidebar as unknown as Window,
      sidebarOrigin: 'https://sidebar.test',
      sidebarReady: () => ready,
      createChannel: () => new MessageChannel(),
    });
    cleanups.push(() => host.close());
    const child = fakeWindow(top);
    top.deliver(envelope({ type: 'guest.discover', guestId: 'g2' }), 'https://frame.test', child);
    ready = true;
    top.deliver(envelope({ type: 'guest.discover', guestId: 'g3' }), 'https://popup.test', popup);
    top.deliver(envelope({ type: 'guest.discover', guestId: 'g4' }), 'https://top.test', top);
    top.deliver({ type: 'guest.discover', guestId: 'g5' }, 'https://frame.test', child);
    top.deliver(
      { ...envelope({ type: 'guest.discover', guestId: 'g6' }), version: RPC_PROTOCOL_VERSION + 1 },
      'https://frame.test',
      child,
    );
    expect(sidebar.inbox).toEqual([]);
    expect(host.guestIds).toEqual([]);
  });

  it('announces to every frame and reports frames that closed', () => {
    vi.useFakeTimers();
    const top = fakeWindow();
    const sidebar = fakeWindow(top);
    const child = fakeWindow(top);
    top.frames = [child];
    const host = new Host({
      window: top as unknown as Window,
      sidebarWindow: () => sidebar as unknown as Window,
      sidebarOrigin: 'https://sidebar.test',
      sidebarReady: () => true,
      createChannel: () => new MessageChannel(),
      sweepIntervalMs: 50,
    });
    cleanups.push(() => host.close());
    host.announce();
    expect(child.inbox).toEqual([
      { data: envelope({ type: 'host.ready' }), origin: '*', ports: [] },
    ]);
    top.deliver(envelope({ type: 'guest.discover', guestId: 'g2' }), 'https://frame.test', child);
    expect(host.guestIds).toEqual(['g2']);
    (child as FrameWindowLike & { closed: boolean }).closed = true;
    vi.advanceTimersByTime(60);
    expect(host.guestIds).toEqual([]);
    expect(sidebar.inbox.at(-1)).toEqual({
      data: envelope({ type: 'guest.disconnect', guestId: 'g2' }),
      origin: 'https://sidebar.test',
      ports: [],
    });
    for (const entry of [...sidebar.inbox, ...child.inbox]) {
      for (const port of entry.ports) (port as MessagePort).close();
    }
  });
});

describe('SubGuestConnection', () => {
  it('discovers through the top window, takes the port from it and speaks the protocol', async () => {
    const top = fakeWindow();
    const child = fakeWindow(top);
    const received: SidebarMessage[] = [];
    const connected = vi.fn();
    const connection = new SubGuestConnection({
      window: child as unknown as Window,
      guestId: 'g2',
      capabilities: { highlights: 'css-highlight', role: 'sub' },
      onMessage: (m) => received.push(m),
      onConnected: connected,
      discoverIntervalMs: 10_000,
    });
    cleanups.push(() => connection.close());
    expect(top.inbox).toEqual([
      { data: envelope({ type: 'guest.discover', guestId: 'g2' }), origin: '*', ports: [] },
    ]);

    // A port from somewhere other than the top window is ignored.
    const stray = new MessageChannel();
    child.deliver(
      envelope({ type: 'host.port', guestId: 'g2' }),
      'https://evil.test',
      fakeWindow(),
      [stray.port1],
    );
    expect(connection.connected).toBe(false);
    stray.port1.close();
    stray.port2.close();

    const channel = new MessageChannel();
    const sidebarSide: GuestMessage[] = [];
    channel.port2.addEventListener('message', (e) => {
      const m = parseGuestMessage(e.data);
      if (m) sidebarSide.push(m);
    });
    channel.port2.start();
    child.deliver(envelope({ type: 'host.port', guestId: 'g2' }), 'https://top.test', top, [
      channel.port1,
    ]);
    await flush();
    expect(sidebarSide).toEqual([
      envelope({
        type: 'guest.hello',
        guestId: 'g2',
        capabilities: { highlights: 'css-highlight', role: 'sub' },
      }),
    ]);
    expect(connection.send({ type: 'highlights.hovered', ids: [] })).toBe(false);
    channel.port2.postMessage(envelope({ type: 'sidebar.hello' }));
    await flush();
    expect(connected).toHaveBeenCalledTimes(1);
    channel.port2.postMessage(envelope({ type: 'highlights.focus', ids: ['urn:a'] }));
    await flush();
    expect(received).toEqual([envelope({ type: 'highlights.focus', ids: ['urn:a'] })]);

    // host.ready means a new sidebar: discover again.
    child.deliver(envelope({ type: 'host.ready' }), 'https://top.test', top);
    expect(connection.connected).toBe(false);
    expect(top.inbox).toHaveLength(2);
    channel.port2.close();
  });

  it('asks again at intervals until a port arrives', () => {
    vi.useFakeTimers();
    const top = fakeWindow();
    const child = fakeWindow(top);
    const connection = new SubGuestConnection({
      window: child as unknown as Window,
      guestId: 'g2',
      capabilities: { highlights: 'overlay', role: 'sub' },
      onMessage: () => undefined,
      discoverIntervalMs: 100,
    });
    cleanups.push(() => connection.close());
    vi.advanceTimersByTime(250);
    expect(top.inbox).toHaveLength(3);
  });
});
