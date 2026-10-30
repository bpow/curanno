/**
 * The sidebar's end of the guest/sidebar RPC protocol
 * (docs/guest-sidebar-rpc.md, ADR 0007): discovery over window messages,
 * then a `MessagePort` the guest transfers with `guest.connect`. The
 * sidebar cannot know the page's origin in advance, so it accepts
 * `guest.connect` only from `window.parent` and learns the guest's origin
 * from that message. Nothing here carries a token, a body, a tag or a
 * creator in either direction: the protocol has no field for them.
 *
 * One connection at a time: a later `guest.connect` (a reloaded guest, or
 * the page pretending to be one) replaces the port, and the outstanding
 * anchor requests are sent again so the new guest draws what the old one
 * did. Serving several guests from one sidebar is Phase 5 work.
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseGuestMessage,
  parseWindowMessage,
  type AnchoringState,
  type GuestMessage,
  type Payload,
  type SidebarErrorMessage,
  type SidebarMessage,
  type SidebarReadyMessage,
} from '@scale/model';
import { shallowReadonly, shallowRef, type Ref } from 'vue';
import type { AnchorRequest, Guest, GuestDocument, GuestSelection } from './types';

/** What a window message looks like to the transport; tests build these by hand. */
export interface MessageEventLike {
  data: unknown;
  origin: string;
  source: unknown;
  ports: readonly PortLike[];
}

/** The subset of `MessagePort` the transport uses. */
export interface PortLike {
  postMessage(message: unknown): void;
  start?(): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** The subset of the sidebar's own window the transport uses. */
export interface WindowLike {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

export interface RpcGuestOptions {
  /** The sidebar's window. Default the global one. */
  window?: WindowLike;
}

export interface RpcGuest extends Guest {
  /** The origin the connected guest's page is served from, once a guest has connected. */
  readonly guestOrigin: Readonly<Ref<string | undefined>>;
  /** True between `guest.hello` on the current port and the next reconnection. */
  readonly connected: Readonly<Ref<boolean>>;
  /** Stops listening and closes the port. */
  close(): void;
}

export function createRpcGuest(options: RpcGuestOptions = {}): RpcGuest {
  const win: WindowLike = options.window ?? window;
  const document = shallowRef<GuestDocument>();
  const selection = shallowRef<GuestSelection>();
  const anchoring = shallowRef<ReadonlyMap<string, AnchoringState>>(new Map());
  const hovered = shallowRef<readonly string[]>([]);
  const guestOrigin = shallowRef<string>();
  const connected = shallowRef(false);
  const activateHandlers = new Set<(ids: string[]) => void>();
  /** Everything asked to be anchored and not withdrawn, re-sent to a reconnecting guest. */
  const requests = new Map<string, AnchorRequest>();
  let port: PortLike | undefined;
  let portListener: ((event: { data: unknown }) => void) | undefined;
  let closed = false;

  function post(target: PortLike, message: Payload<SidebarMessage>): void {
    // Targets arrive as reactive proxies from the store, which structured
    // clone refuses; the protocol is plain JSON in any case.
    target.postMessage(JSON.parse(JSON.stringify(envelope(message))));
  }

  /** Sends to the connected guest; dropped when there is none. */
  function send(message: Payload<SidebarMessage>): boolean {
    if (!port || !connected.value) return false;
    post(port, message);
    return true;
  }

  function error(target: PortLike, message: string, inReplyTo?: string): void {
    const payload: Payload<SidebarErrorMessage> = { type: 'sidebar.error', message };
    if (inReplyTo !== undefined) payload.inReplyTo = inReplyTo;
    post(target, payload);
  }

  function dropPort(): void {
    if (port && portListener) port.removeEventListener('message', portListener);
    port?.close();
    port = undefined;
    portListener = undefined;
    connected.value = false;
  }

  function onWindowMessage(event: MessageEventLike): void {
    if (closed || event.source !== win.parent) return;
    const message = parseWindowMessage(event.data);
    if (!message || message.type !== 'guest.connect') return;
    const next = event.ports[0];
    if (!next) return;
    if (message.version !== RPC_PROTOCOL_VERSION) {
      error(next, `unsupported protocol version ${message.version}`, message.type);
      next.close();
      return;
    }
    dropPort();
    guestOrigin.value = event.origin;
    port = next;
    portListener = (e) => onPortMessage(next, e.data);
    next.addEventListener('message', portListener);
    next.start?.();
    // The new guest has no highlights yet; results arrive after it anchors.
    anchoring.value = new Map();
    hovered.value = [];
    selection.value = undefined;
  }

  function onPortMessage(from: PortLike, data: unknown): void {
    if (from !== port) return;
    const message = parseGuestMessage(data);
    if (!message) return;
    if (message.version !== RPC_PROTOCOL_VERSION) {
      error(from, `unsupported protocol version ${message.version}`, message.type);
      return;
    }
    if (message.type === 'guest.hello') {
      post(from, { type: 'sidebar.hello' });
      connected.value = true;
      if (requests.size > 0) send({ type: 'annotations.anchor', requests: [...requests.values()] });
      return;
    }
    if (!connected.value) return;
    handle(message);
  }

  function handle(message: Exclude<GuestMessage, { type: 'guest.hello' }>): void {
    switch (message.type) {
      case 'document.report':
        document.value = message.document;
        break;
      case 'anchoring.results': {
        const next = new Map(anchoring.value);
        for (const result of message.results) {
          if (requests.has(result.id)) next.set(result.id, result.state);
        }
        anchoring.value = next;
        break;
      }
      case 'selection.changed':
        selection.value = message.selection ?? undefined;
        break;
      case 'highlights.hovered':
        hovered.value = message.ids;
        break;
      case 'highlights.activated':
        for (const handler of activateHandlers) handler(message.ids);
        break;
      case 'sidebar.visibility':
        break;
      case 'guest.error':
        console.warn(`[guest] ${message.message}`, message.inReplyTo ?? '');
        break;
    }
  }

  win.addEventListener('message', onWindowMessage);
  win.parent.postMessage(envelope<SidebarReadyMessage>({ type: 'sidebar.ready' }), '*');

  return {
    document: shallowReadonly(document),
    selection: shallowReadonly(selection),
    anchoring: shallowReadonly(anchoring),
    hovered: shallowReadonly(hovered),
    guestOrigin: shallowReadonly(guestOrigin),
    connected: shallowReadonly(connected),

    anchor(next) {
      for (const request of next) requests.set(request.id, request);
      send({ type: 'annotations.anchor', requests: next });
    },
    unanchor(ids) {
      for (const id of ids) requests.delete(id);
      const map = new Map(anchoring.value);
      for (const id of ids) map.delete(id);
      anchoring.value = map;
      send({ type: 'annotations.unanchor', ids });
    },
    focus(ids) {
      send({ type: 'highlights.focus', ids });
    },
    scrollTo(id) {
      send({ type: 'scroll.to', id });
    },
    clearSelection() {
      selection.value = undefined;
      send({ type: 'selection.clear' });
    },
    onActivate(handler) {
      activateHandlers.add(handler);
      return () => activateHandlers.delete(handler);
    },
    close() {
      closed = true;
      win.removeEventListener('message', onWindowMessage);
      dropPort();
    },
  };
}
