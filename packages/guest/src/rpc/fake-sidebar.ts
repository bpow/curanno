/**
 * An in-memory sidebar: the sidebar's end of the protocol without any UI,
 * API or login. It records every guest message, answers the handshake and
 * lets a test or the dev placeholder page send sidebar messages. It also
 * holds a pretend body and token that must never reach the page, which
 * the isolation test checks for.
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseGuestMessage,
  parseWindowMessage,
  type AnchorRequest,
  type AnchoringResult,
  type GuestDocument,
  type GuestMessage,
  type GuestSelection,
  type Payload,
  type SidebarMessage,
  type SidebarReadyMessage,
} from '@curanno/model';
import type { PortLike } from './connection.js';

export interface FakeSidebarOptions {
  /** Called for every valid guest message. */
  onMessage?: (message: GuestMessage) => void;
  /** Reply to `guest.hello` automatically (default true). */
  autoHello?: boolean;
}

/** State the real sidebar would keep on its own origin; the page must never see it. */
export const FAKE_SECRETS = {
  token: 'fake-sidebar-token-7f3a9c1e-do-not-leak',
  body: 'Secret annotation body: the committee voted 7 to 2.',
} as const;

export class FakeSidebar {
  readonly messages: GuestMessage[] = [];
  readonly anchoring = new Map<string, AnchoringResult>();
  document: GuestDocument | undefined;
  selection: GuestSelection | null = null;
  hovered: string[] = [];
  activated: string[][] = [];
  sidebarOpen: boolean | undefined;
  guestId: string | undefined;
  /** This load's `sidebar.ready` instance. */
  readonly instance = Math.random().toString(36).slice(2);
  private port: PortLike | undefined;
  private readonly waiters: { type: string; resolve: (m: GuestMessage) => void }[] = [];

  constructor(private readonly options: FakeSidebarOptions = {}) {}

  /** Take over a port the guest transferred (after `guest.connect`). */
  attach(port: PortLike): void {
    this.port?.close();
    this.port = port;
    port.addEventListener('message', (event) => this.receive(event.data));
    port.start?.();
  }

  /** The window-level `sidebar.ready` message, for the page that hosts the fake. */
  readyMessage(): SidebarReadyMessage {
    return envelope<SidebarReadyMessage>({ type: 'sidebar.ready', instance: this.instance });
  }

  /** Whether `data` is a `guest.connect` message; the caller attaches `ports[0]`. */
  static isConnect(data: unknown): boolean {
    return parseWindowMessage(data)?.type === 'guest.connect';
  }

  send(message: Payload<SidebarMessage>): void {
    if (!this.port) throw new Error('fake sidebar has no port');
    this.port.postMessage(envelope(message));
  }

  hello(): void {
    this.send({ type: 'sidebar.hello' });
  }

  anchor(requests: AnchorRequest[]): void {
    this.send({ type: 'annotations.anchor', requests });
  }

  unanchor(ids: string[]): void {
    this.send({ type: 'annotations.unanchor', ids });
  }

  focus(ids: string[]): void {
    this.send({ type: 'highlights.focus', ids });
  }

  scrollTo(id: string): void {
    this.send({ type: 'scroll.to', id });
  }

  clearSelection(): void {
    this.send({ type: 'selection.clear' });
  }

  /** Resolves with the next guest message of `type`. */
  next<T extends GuestMessage['type']>(type: T): Promise<Extract<GuestMessage, { type: T }>> {
    return new Promise((resolve) => {
      this.waiters.push({
        type,
        resolve: (m) => resolve(m as Extract<GuestMessage, { type: T }>),
      });
    });
  }

  private receive(data: unknown): void {
    const message = parseGuestMessage(data);
    if (!message) return;
    if (message.version !== RPC_PROTOCOL_VERSION) {
      this.send({
        type: 'sidebar.error',
        message: `unsupported protocol version ${message.version}`,
      });
      return;
    }
    this.messages.push(message);
    switch (message.type) {
      case 'guest.hello':
        this.guestId = message.guestId;
        if (this.options.autoHello !== false) this.hello();
        break;
      case 'document.report':
        this.document = message.document;
        break;
      case 'anchoring.results':
        for (const result of message.results) this.anchoring.set(result.id, result);
        break;
      case 'selection.changed':
        this.selection = message.selection;
        break;
      case 'highlights.hovered':
        this.hovered = message.ids;
        break;
      case 'highlights.activated':
        this.activated.push(message.ids);
        break;
      case 'sidebar.visibility':
        this.sidebarOpen = message.open;
        break;
      case 'guest.error':
        break;
    }
    this.options.onMessage?.(message);
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.type === message.type) waiter.resolve(message);
      else this.waiters.push(waiter);
    }
  }
}
