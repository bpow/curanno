/**
 * The connection of a guest in a frame other than the one holding the
 * sidebar (docs/guest-sidebar-rpc.md, section 3; ADR 0024). It cannot find
 * the sidebar's window, which sits in the host's closed shadow root, so it
 * waits for the sidebar to announce itself: `sidebar.ready` from a window
 * of this page whose origin is the configured sidebar origin. It answers
 * that window with `guest.connect` and a port, addressed to the sidebar
 * origin, so the browser delivers the port to the sidebar and nothing
 * else, and the sidebar learns this frame's origin from the browser. The
 * page around this frame takes no part in it.
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  isFrameOf,
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
import type { Connection, PortLike } from './connection.js';

/** The subset of the sidebar's `WindowProxy` the connection posts to. */
interface SidebarWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

export interface SubGuestConnectionOptions {
  /** The frame's own window. */
  window: Window;
  /** The origin the sidebar is served from; the only origin accepted. */
  sidebarOrigin: string;
  guestId: string;
  capabilities: GuestCapabilities;
  onMessage: (message: SidebarMessage) => void;
  onConnected?: () => void;
  /** Makes the channel; tests inject one. */
  createChannel?: () => { port1: PortLike; port2: unknown };
}

export class SubGuestConnection implements Connection {
  private readonly options: SubGuestConnectionOptions;
  private readonly listener: (event: MessageEvent) => void;
  private port: PortLike | undefined;
  private portListener: ((event: { data: unknown }) => void) | undefined;
  /** The `sidebar.ready` instance the current port was offered to. */
  private instance: string | undefined;
  private ready = false;
  private closed = false;

  constructor(options: SubGuestConnectionOptions) {
    this.options = options;
    this.listener = (event) => this.onWindowMessage(event);
    options.window.addEventListener('message', this.listener);
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
    this.options.window.removeEventListener('message', this.listener);
    this.dropPort();
  }

  private onWindowMessage(event: MessageEvent): void {
    if (this.closed) return;
    if (event.origin !== this.options.sidebarOrigin) return;
    if (!isFrameOf(event.source, this.options.window.top)) return;
    const message = parseWindowMessage(event.data);
    if (message?.type !== 'sidebar.ready' || message.version !== RPC_PROTOCOL_VERSION) return;
    // The sidebar repeats itself for frames that start later; a new instance means it reloaded.
    if (this.port && message.instance === this.instance) return;
    this.connect(event.source as unknown as SidebarWindowLike, message.instance);
  }

  private connect(sidebar: SidebarWindowLike, instance: string): void {
    this.dropPort();
    const channel = this.options.createChannel?.() ?? new MessageChannel();
    const port = channel.port1;
    this.port = port;
    this.instance = instance;
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
      return;
    }
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
    this.instance = undefined;
    this.ready = false;
  }
}
