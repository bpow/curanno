/**
 * The host's port provider (docs/guest-sidebar-rpc.md, section 3): the
 * guest in the frame that holds the sidebar hands every other frame's
 * guest a channel to it. A guest in a child frame posts `guest.discover` to
 * the top window; the host makes a `MessageChannel`, sends one end back to
 * that frame with `host.port` and the other to the sidebar with
 * `guest.connect` carrying the frame's origin. The host never reads the
 * traffic on those channels. When a frame goes away the host tells the
 * sidebar with `guest.disconnect`; when the sidebar (re)connects it tells
 * every frame with `host.ready`, so their guests ask again.
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseWindowMessage,
  type GuestConnectMessage,
  type GuestDisconnectMessage,
  type HostPortMessage,
  type HostReadyMessage,
} from '@scale/model';

/** The subset of a cross-origin `WindowProxy` the host uses. */
export interface FrameWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  readonly closed: boolean;
  readonly top: unknown;
}

export interface HostOptions {
  /** The host's own window. */
  window: Window;
  /** The sidebar's window, or null until it exists. */
  sidebarWindow: () => Window | null;
  sidebarOrigin: string;
  /** Whether the sidebar has sent `sidebar.ready` and accepts connects. */
  sidebarReady: () => boolean;
  createChannel?: () => { port1: unknown; port2: unknown };
  /** How often frames are checked for having gone away. Default 1 s. */
  sweepIntervalMs?: number;
}

export class Host {
  private readonly options: HostOptions;
  private readonly listener: (event: MessageEvent) => void;
  /** Frames with a guest the sidebar knows about, by guest id. */
  private readonly frames = new Map<string, FrameWindowLike>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(options: HostOptions) {
    this.options = options;
    this.listener = (event) => this.onWindowMessage(event);
    options.window.addEventListener('message', this.listener);
    this.timer = setInterval(() => this.sweep(), options.sweepIntervalMs ?? 1000);
  }

  /** Guest ids of the frames currently connected through this host. */
  get guestIds(): string[] {
    return [...this.frames.keys()];
  }

  /** Tell every frame in the page that the sidebar takes connections now. */
  announce(): void {
    this.frames.clear();
    const frames = this.options.window.frames;
    for (let i = 0; i < frames.length; i++) {
      try {
        frames[i]?.postMessage(envelope<HostReadyMessage>({ type: 'host.ready' }), '*');
      } catch {
        // A frame mid-navigation; it will discover on its own when it loads.
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.options.window.removeEventListener('message', this.listener);
    this.frames.clear();
  }

  private onWindowMessage(event: MessageEvent): void {
    if (this.closed) return;
    const message = parseWindowMessage(event.data);
    if (!message || message.type !== 'guest.discover') return;
    if (message.version !== RPC_PROTOCOL_VERSION) return;
    const source = event.source as FrameWindowLike | null;
    // Only frames of this page: their `top` is this window. A popup's is not.
    if (!source || source === (this.options.window as unknown) || !this.isInPage(source)) return;
    const sidebar = this.options.sidebarWindow();
    if (!sidebar || !this.options.sidebarReady()) return;
    const channel = this.options.createChannel?.() ?? new MessageChannel();
    const frameOrigin = event.origin;
    sidebar.postMessage(
      envelope<GuestConnectMessage>({
        type: 'guest.connect',
        guestId: message.guestId,
        frameOrigin,
      }),
      this.options.sidebarOrigin,
      [channel.port2 as Transferable],
    );
    // An opaque origin ("null") cannot be a target origin; the source check above still holds.
    source.postMessage(
      envelope<HostPortMessage>({ type: 'host.port', guestId: message.guestId }),
      frameOrigin === 'null' ? '*' : frameOrigin,
      [channel.port1 as Transferable],
    );
    this.frames.set(message.guestId, source);
  }

  private isInPage(source: FrameWindowLike): boolean {
    try {
      return source.top === (this.options.window as unknown);
    } catch {
      return false;
    }
  }

  /** Forget frames whose window closed and tell the sidebar. */
  private sweep(): void {
    const sidebar = this.options.sidebarWindow();
    for (const [guestId, frame] of this.frames) {
      if (!isClosed(frame)) continue;
      this.frames.delete(guestId);
      sidebar?.postMessage(
        envelope<GuestDisconnectMessage>({ type: 'guest.disconnect', guestId }),
        this.options.sidebarOrigin,
      );
    }
  }
}

function isClosed(frame: FrameWindowLike): boolean {
  try {
    return frame.closed;
  } catch {
    return true;
  }
}
