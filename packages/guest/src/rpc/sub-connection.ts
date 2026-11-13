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
import { RPC_PROTOCOL_VERSION, isFrameOf, parseWindowMessage } from '@curanno/model';
import { PortConnection, type ConnectionOptions, type SidebarWindowLike } from './connection.js';

export type SubGuestConnectionOptions = ConnectionOptions;

export class SubGuestConnection extends PortConnection<SubGuestConnectionOptions> {
  /** The `sidebar.ready` instance the current port was offered to. */
  private instance: string | undefined;

  protected onWindowMessage(event: MessageEvent): void {
    if (event.origin !== this.options.sidebarOrigin) return;
    if (!isFrameOf(event.source, this.options.window.top)) return;
    const message = parseWindowMessage(event.data);
    if (message?.type !== 'sidebar.ready' || message.version !== RPC_PROTOCOL_VERSION) return;
    // The sidebar repeats itself for frames that start later; a new instance means it reloaded.
    if (this.port && message.instance === this.instance) return;
    if (this.connect(event.source as unknown as SidebarWindowLike)) {
      this.instance = message.instance;
    }
  }

  protected override dropPort(): void {
    super.dropPort();
    this.instance = undefined;
  }
}
