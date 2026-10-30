/**
 * The connection of a guest in a frame other than the one holding the
 * sidebar (docs/guest-sidebar-rpc.md, section 3). It cannot reach the
 * sidebar's window, so it asks the host in the top frame for a port with
 * `guest.discover`, accepts `host.port` only from `window.top`, and then
 * speaks the ordinary port protocol. It asks again on `host.ready` (the
 * host or its sidebar started after this frame did) and at intervals until
 * a port arrives, since the host may be injected at any time.
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseSidebarMessage,
  parseWindowMessage,
  type GuestCapabilities,
  type GuestDiscoverMessage,
  type GuestErrorMessage,
  type GuestHelloMessage,
  type GuestMessage,
  type Payload,
  type SidebarMessage,
} from '@scale/model';
import type { Connection, PortLike } from './connection.js';

export interface SubGuestConnectionOptions {
  /** The frame's own window. */
  window: Window;
  guestId: string;
  capabilities: GuestCapabilities;
  onMessage: (message: SidebarMessage) => void;
  onConnected?: () => void;
  /** How often to ask again while no port has arrived. Default 2 s. */
  discoverIntervalMs?: number;
}

export class SubGuestConnection implements Connection {
  private readonly options: SubGuestConnectionOptions;
  private readonly listener: (event: MessageEvent) => void;
  private port: PortLike | undefined;
  private portListener: ((event: { data: unknown }) => void) | undefined;
  private ready = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: SubGuestConnectionOptions) {
    this.options = options;
    this.listener = (event) => this.onWindowMessage(event);
    options.window.addEventListener('message', this.listener);
    this.discover();
    this.timer = setInterval(() => {
      if (!this.port) this.discover();
    }, options.discoverIntervalMs ?? 2000);
  }

  get connected(): boolean {
    return this.ready;
  }

  send(message: Payload<GuestMessage>): boolean {
    if (!this.port || (!this.ready && message.type !== 'guest.hello')) return false;
    this.port.postMessage(envelope(message));
    return true;
  }

  error(message: string, inReplyTo?: string): void {
    const payload: Payload<GuestErrorMessage> = { type: 'guest.error', message };
    if (inReplyTo !== undefined) payload.inReplyTo = inReplyTo;
    this.send(payload);
  }

  close(): void {
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.options.window.removeEventListener('message', this.listener);
    this.dropPort();
  }

  /** Ask the top frame's host for a port. Carries only the guest id. */
  private discover(): void {
    const top = this.options.window.top;
    if (!top || top === this.options.window) return;
    try {
      top.postMessage(
        envelope<GuestDiscoverMessage>({ type: 'guest.discover', guestId: this.options.guestId }),
        '*',
      );
    } catch {
      // A detached frame has no top to speak to.
    }
  }

  private onWindowMessage(event: MessageEvent): void {
    if (this.closed) return;
    const top = this.options.window.top;
    if (!top || event.source !== top) return;
    const message = parseWindowMessage(event.data);
    if (!message || message.version !== RPC_PROTOCOL_VERSION) return;
    if (message.type === 'host.ready') {
      // A new sidebar: the old port, if any, leads nowhere now.
      this.dropPort();
      this.discover();
      return;
    }
    if (message.type !== 'host.port' || message.guestId !== this.options.guestId) return;
    const port = event.ports[0] as PortLike | undefined;
    if (!port) return;
    this.attach(port);
  }

  private attach(port: PortLike): void {
    this.dropPort();
    this.port = port;
    this.portListener = (event) => this.onPortMessage(port, event.data);
    port.addEventListener('message', this.portListener);
    port.start?.();
    const hello: Payload<GuestHelloMessage> = {
      type: 'guest.hello',
      guestId: this.options.guestId,
      capabilities: this.options.capabilities,
    };
    this.send(hello);
  }

  private onPortMessage(port: PortLike, data: unknown): void {
    if (port !== this.port) return;
    const message = parseSidebarMessage(data);
    if (!message) return;
    if (message.version !== RPC_PROTOCOL_VERSION) {
      port.postMessage(
        envelope<GuestErrorMessage>({
          type: 'guest.error',
          message: `unsupported protocol version ${message.version}`,
        }),
      );
      return;
    }
    if (message.type === 'sidebar.hello') {
      const first = !this.ready;
      this.ready = true;
      if (first) this.options.onConnected?.();
      return;
    }
    if (!this.ready) return;
    this.options.onMessage(message);
  }

  private dropPort(): void {
    if (this.port && this.portListener) this.port.removeEventListener('message', this.portListener);
    this.port?.close();
    this.port = undefined;
    this.portListener = undefined;
    this.ready = false;
  }
}
