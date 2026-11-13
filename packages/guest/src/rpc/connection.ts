/**
 * The host guest's end of the RPC protocol (docs/guest-sidebar-rpc.md):
 * discovery over window messages with strict origin and source checks, then
 * a `MessageChannel` port per connection. Nothing here knows about anchoring
 * or highlights; `guest.ts` wires handlers to it. A guest in another frame
 * of the page connects with `SubGuestConnection` instead; both share the
 * port handling in `PortConnection`.
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseSidebarMessage,
  parseWindowMessage,
  type GuestCapabilities,
  type GuestConnectMessage,
  type GuestErrorMessage,
  type GuestHelloMessage,
  type GuestMessage,
  type Payload,
  type SidebarMessage,
} from '@curanno/model';

/** What `guest.ts` needs from a connection, whichever frame the guest is in. */
export interface Connection {
  readonly connected: boolean;
  send(message: Payload<GuestMessage>): boolean;
  error(message: string, inReplyTo?: string): void;
  close(): void;
}

/** The subset of `MessagePort` the connection uses, so tests can substitute Node's. */
export interface PortLike {
  postMessage(message: unknown): void;
  start?(): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** The subset of the sidebar's `WindowProxy` the connection posts to. */
export interface SidebarWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

export interface ConnectionOptions {
  /** The window the guest runs in; listens for `sidebar.ready` on it. */
  window: Window;
  /** The origin the sidebar is served from; the only origin accepted. */
  sidebarOrigin: string;
  guestId: string;
  capabilities: GuestCapabilities;
  /** Called for every valid sidebar message on the current port. */
  onMessage: (message: SidebarMessage) => void;
  /** Called once per connection after `sidebar.hello`. */
  onConnected?: () => void;
  /** Makes the channel; tests inject one. */
  createChannel?: () => { port1: PortLike; port2: unknown };
}

type PortListener = (event: { data: unknown }) => void;

/**
 * The port side shared by both connections: offering a port to the sidebar,
 * the hello handshake, and checking what arrives on the port. Subclasses
 * decide which window message means the sidebar is ready.
 */
export abstract class PortConnection<O extends ConnectionOptions> implements Connection {
  protected readonly options: O;
  private readonly windowListener: (event: MessageEvent) => void;
  protected port: PortLike | undefined;
  private portListener: PortListener | undefined;
  private ready = false;
  private closed = false;

  constructor(options: O) {
    this.options = options;
    this.windowListener = (event) => {
      if (!this.closed) this.onWindowMessage(event);
    };
    options.window.addEventListener('message', this.windowListener);
  }

  /** True once `sidebar.hello` has arrived on the current port. */
  get connected(): boolean {
    return this.ready;
  }

  /** Send a message to the sidebar. Dropped before the handshake completes. */
  send(message: Payload<GuestMessage>): boolean {
    if (!this.port || (!this.ready && message.type !== 'guest.hello')) return false;
    this.port.postMessage(envelope(message));
    return true;
  }

  /** Tell the sidebar something it sent could not be handled. */
  error(message: string, inReplyTo?: string): void {
    const payload: Payload<GuestErrorMessage> = { type: 'guest.error', message };
    if (inReplyTo !== undefined) payload.inReplyTo = inReplyTo;
    this.send(payload);
  }

  close(): void {
    this.closed = true;
    this.options.window.removeEventListener('message', this.windowListener);
    this.dropPort();
  }

  protected abstract onWindowMessage(event: MessageEvent): void;

  /** Replace the port with a new one offered to `sidebar`; false if it could not be posted. */
  protected connect(sidebar: SidebarWindowLike): boolean {
    this.dropPort();
    const channel = this.options.createChannel?.() ?? new MessageChannel();
    const port = channel.port1;
    this.port = port;
    this.portListener = (event) => this.onPortMessage(port, event.data);
    port.addEventListener('message', this.portListener);
    port.start?.();
    const connect = envelope<GuestConnectMessage>({
      type: 'guest.connect',
      guestId: this.options.guestId,
    });
    try {
      sidebar.postMessage(connect, this.options.sidebarOrigin, [channel.port2 as Transferable]);
    } catch {
      // The sidebar went away meanwhile; the next `sidebar.ready` tries again.
      this.dropPort();
      return false;
    }
    const hello: Payload<GuestHelloMessage> = {
      type: 'guest.hello',
      guestId: this.options.guestId,
      capabilities: this.options.capabilities,
    };
    this.send(hello);
    return true;
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

  protected dropPort(): void {
    if (this.port && this.portListener) this.port.removeEventListener('message', this.portListener);
    this.port?.close();
    this.port = undefined;
    this.portListener = undefined;
    this.ready = false;
  }
}

export interface GuestConnectionOptions extends ConnectionOptions {
  /** The sidebar iframe's window, or null until it exists. */
  sidebarWindow: () => Window | null;
}

export class GuestConnection extends PortConnection<GuestConnectionOptions> {
  protected onWindowMessage(event: MessageEvent): void {
    const sidebar = this.options.sidebarWindow();
    if (!sidebar || event.source !== sidebar) return;
    if (event.origin !== this.options.sidebarOrigin) return;
    const message = parseWindowMessage(event.data);
    if (!message || message.type !== 'sidebar.ready') return;
    if (message.version !== RPC_PROTOCOL_VERSION) return;
    this.connect(sidebar);
  }
}
