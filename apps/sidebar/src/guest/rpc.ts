/**
 * The sidebar's end of the guest/sidebar RPC protocol
 * (docs/guest-sidebar-rpc.md, ADR 0007): discovery over window messages,
 * then one `MessagePort` per guest, transferred with `guest.connect`. The
 * sidebar cannot know the page's origin in advance, so it accepts
 * `guest.connect` and `guest.disconnect` only from `window.parent` (the
 * host) and takes a guest's origin from that message: the event's origin
 * for the host's own guest, `frameOrigin` for a guest in another frame,
 * which the host relays. Nothing here carries a token, a body, a tag or a
 * creator in either direction: the protocol has no field for them.
 *
 * Several guests at a time, one per frame, each with its document. A
 * connect for a known guest id (a reloaded frame) replaces that guest's
 * port; the anchor requests for its document are sent again once it
 * reports the document, so the new guest draws what the old one did.
 *
 * A guest may say only what document its own frame shows: a report whose
 * URI is not on the guest's origin is refused, except from the PDF viewer
 * origin, whose page reports the PDF it shows (ADR 0021). Otherwise a page
 * could name any document and receive the selectors, quoted text included,
 * of the user's annotations on it.
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  parseGuestMessage,
  parseWindowMessage,
  type AnchoringState,
  type GuestMessage,
  type GuestRole,
  type Payload,
  type SidebarErrorMessage,
  type SidebarMessage,
  type SidebarReadyMessage,
} from '@curanno/model';
import { shallowReadonly, shallowRef, type Ref } from 'vue';
import type { AnchorRequest, DocumentSelection, Guest, GuestDocument } from './types';

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
  /** Origins whose guests may report a document on another origin: the PDF viewer's. */
  trustedOrigins?: readonly string[];
}

export interface ConnectedGuest {
  id: string;
  /** The origin of the frame the guest runs in. */
  origin: string;
  role: GuestRole;
  connected: boolean;
  document: GuestDocument | undefined;
}

export interface RpcGuest extends Guest {
  /** The origin of the host's page, once the host has connected. */
  readonly guestOrigin: Readonly<Ref<string | undefined>>;
  /** True while any guest is past `guest.hello` on its current port. */
  readonly connected: Readonly<Ref<boolean>>;
  /** Every guest with a port, the host first. */
  readonly guests: Readonly<Ref<readonly ConnectedGuest[]>>;
  /** Stops listening and closes every port. */
  close(): void;
}

interface GuestEntry {
  id: string;
  origin: string;
  role: GuestRole;
  port: PortLike;
  listener: (event: { data: unknown }) => void;
  connected: boolean;
  document: GuestDocument | undefined;
  /** Results this guest reported, by IRI. */
  anchoring: Map<string, AnchoringState>;
  /** IRIs this guest was asked to anchor. */
  asked: Set<string>;
  hovered: string[];
}

const STATE_RANK: Record<AnchoringState, number> = {
  anchored: 3,
  repaired: 3,
  ambiguous: 2,
  orphaned: 1,
};

/** Whether a guest on `origin` may report `uri` as its document. */
export function mayReport(uri: string, origin: string, trusted: readonly string[]): boolean {
  if (trusted.includes(origin)) return true;
  try {
    const url = new URL(uri);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
  } catch {
    return false;
  }
}

export function createRpcGuest(options: RpcGuestOptions = {}): RpcGuest {
  const win: WindowLike = options.window ?? window;
  const trusted = options.trustedOrigins ?? [];
  const entries = new Map<string, GuestEntry>();
  /** Everything asked to be anchored and not withdrawn, by document URI then IRI. */
  const requestsByDocument = new Map<string, Map<string, AnchorRequest>>();
  /** Requests made before any document was known, sent to every guest. */
  const requestsForAll = new Map<string, AnchorRequest>();

  const document = shallowRef<GuestDocument>();
  const documents = shallowRef<readonly GuestDocument[]>([]);
  const selection = shallowRef<DocumentSelection>();
  const anchoring = shallowRef<ReadonlyMap<string, AnchoringState>>(new Map());
  const hovered = shallowRef<readonly string[]>([]);
  const guestOrigin = shallowRef<string>();
  const connected = shallowRef(false);
  const guests = shallowRef<readonly ConnectedGuest[]>([]);
  const activateHandlers = new Set<(ids: string[]) => void>();
  let selectionOwner: string | undefined;
  let closed = false;

  function post(target: PortLike, message: Payload<SidebarMessage>): void {
    // Targets arrive as reactive proxies from the store, which structured
    // clone refuses; the protocol is plain JSON in any case.
    target.postMessage(JSON.parse(JSON.stringify(envelope(message))));
  }

  function send(entry: GuestEntry, message: Payload<SidebarMessage>): boolean {
    if (!entry.connected) return false;
    post(entry.port, message);
    return true;
  }

  function error(target: PortLike, message: string, inReplyTo?: string): void {
    const payload: Payload<SidebarErrorMessage> = { type: 'sidebar.error', message };
    if (inReplyTo !== undefined) payload.inReplyTo = inReplyTo;
    post(target, payload);
  }

  function host(): GuestEntry | undefined {
    for (const entry of entries.values()) if (entry.role === 'host') return entry;
    return undefined;
  }

  function ordered(): GuestEntry[] {
    return [...entries.values()].sort(
      (a, b) => Number(b.role === 'host') - Number(a.role === 'host'),
    );
  }

  /** Recompute every derived ref from the entries. */
  function publish(): void {
    const list = ordered();
    guests.value = list.map((e) => ({
      id: e.id,
      origin: e.origin,
      role: e.role,
      connected: e.connected,
      document: e.document,
    }));
    connected.value = list.some((e) => e.connected);
    document.value = host()?.document;
    const seen = new Set<string>();
    const docs: GuestDocument[] = [];
    for (const e of list) {
      if (e.document && !seen.has(e.document.uri)) {
        seen.add(e.document.uri);
        docs.push(e.document);
      }
    }
    documents.value = docs;
    const merged = new Map<string, AnchoringState>();
    for (const e of list) {
      for (const [id, state] of e.anchoring) {
        const current = merged.get(id);
        if (!current || STATE_RANK[state] > STATE_RANK[current]) merged.set(id, state);
      }
    }
    anchoring.value = merged;
    hovered.value = [...new Set(list.flatMap((e) => e.hovered))];
  }

  function requestsFor(uri: string): AnchorRequest[] {
    return [...requestsForAll.values(), ...(requestsByDocument.get(uri)?.values() ?? [])];
  }

  /** Send a guest the requests for its document; nothing before it reports one. */
  function sendRequests(entry: GuestEntry, requests: AnchorRequest[]): void {
    if (requests.length === 0) return;
    for (const r of requests) entry.asked.add(r.id);
    send(entry, { type: 'annotations.anchor', requests });
  }

  function drop(entry: GuestEntry): void {
    entry.port.removeEventListener('message', entry.listener);
    entry.port.close();
    entries.delete(entry.id);
    if (selectionOwner === entry.id) {
      selectionOwner = undefined;
      selection.value = undefined;
    }
  }

  function onWindowMessage(event: MessageEventLike): void {
    if (closed || event.source !== win.parent) return;
    const message = parseWindowMessage(event.data);
    if (!message) return;
    if (message.type === 'guest.disconnect') {
      const entry = entries.get(message.guestId);
      if (entry && message.version === RPC_PROTOCOL_VERSION) {
        drop(entry);
        publish();
      }
      return;
    }
    if (message.type !== 'guest.connect') return;
    const next = event.ports[0];
    if (!next) return;
    if (message.version !== RPC_PROTOCOL_VERSION) {
      error(next, `unsupported protocol version ${message.version}`, message.type);
      next.close();
      return;
    }
    const existing = entries.get(message.guestId);
    if (existing) drop(existing);
    const origin = message.frameOrigin ?? event.origin;
    const entry: GuestEntry = {
      id: message.guestId,
      origin,
      role: message.frameOrigin === undefined ? 'host' : 'sub',
      port: next,
      listener: (e) => onPortMessage(entry, e.data),
      connected: false,
      document: undefined,
      anchoring: new Map(),
      asked: new Set(),
      hovered: [],
    };
    entries.set(entry.id, entry);
    next.addEventListener('message', entry.listener);
    next.start?.();
    if (entry.role === 'host') guestOrigin.value = origin;
    publish();
  }

  function onPortMessage(entry: GuestEntry, data: unknown): void {
    if (entries.get(entry.id) !== entry) return;
    const message = parseGuestMessage(data);
    if (!message) return;
    if (message.version !== RPC_PROTOCOL_VERSION) {
      error(entry.port, `unsupported protocol version ${message.version}`, message.type);
      return;
    }
    if (message.type === 'guest.hello') {
      post(entry.port, { type: 'sidebar.hello' });
      entry.connected = true;
      if (message.capabilities.role) entry.role = message.capabilities.role;
      publish();
      return;
    }
    if (!entry.connected) return;
    handle(entry, message);
  }

  function handle(
    entry: GuestEntry,
    message: Exclude<GuestMessage, { type: 'guest.hello' }>,
  ): void {
    switch (message.type) {
      case 'document.report': {
        const uri = message.document.uri;
        if (!mayReport(uri, entry.origin, trusted)) {
          error(entry.port, `a guest on ${entry.origin} may not report ${uri}`, message.type);
          return;
        }
        entry.document = message.document;
        // Results for the old document, if any, no longer apply.
        entry.anchoring.clear();
        entry.asked.clear();
        publish();
        sendRequests(entry, requestsFor(uri));
        break;
      }
      case 'anchoring.results':
        for (const result of message.results) {
          if (entry.asked.has(result.id)) entry.anchoring.set(result.id, result.state);
        }
        publish();
        break;
      case 'selection.changed':
        if (message.selection && entry.document) {
          selectionOwner = entry.id;
          selection.value = { ...message.selection, document: entry.document };
        } else if (selectionOwner === entry.id || selectionOwner === undefined) {
          selectionOwner = undefined;
          selection.value = undefined;
        }
        break;
      case 'highlights.hovered':
        entry.hovered = message.ids;
        publish();
        break;
      case 'highlights.activated':
        for (const handler of activateHandlers) handler(message.ids);
        break;
      case 'sidebar.visibility':
        break;
      case 'guest.error':
        console.warn(`[guest ${entry.id}] ${message.message}`, message.inReplyTo ?? '');
        break;
    }
  }

  win.addEventListener('message', onWindowMessage);
  win.parent.postMessage(envelope<SidebarReadyMessage>({ type: 'sidebar.ready' }), '*');

  return {
    document: shallowReadonly(document),
    documents: shallowReadonly(documents),
    selection: shallowReadonly(selection),
    anchoring: shallowReadonly(anchoring),
    hovered: shallowReadonly(hovered),
    guestOrigin: shallowReadonly(guestOrigin),
    connected: shallowReadonly(connected),
    guests: shallowReadonly(guests),

    anchor(next, documentUri) {
      const bucket =
        documentUri === undefined
          ? requestsForAll
          : (requestsByDocument.get(documentUri) ??
            requestsByDocument.set(documentUri, new Map()).get(documentUri)!);
      for (const request of next) bucket.set(request.id, request);
      for (const entry of entries.values()) {
        if (!entry.document) continue;
        if (documentUri === undefined || entry.document.uri === documentUri) {
          sendRequests(entry, next);
        }
      }
    },
    unanchor(ids) {
      for (const id of ids) {
        requestsForAll.delete(id);
        for (const bucket of requestsByDocument.values()) bucket.delete(id);
      }
      for (const entry of entries.values()) {
        const mine = ids.filter((id) => entry.asked.has(id));
        for (const id of mine) {
          entry.asked.delete(id);
          entry.anchoring.delete(id);
        }
        if (mine.length) send(entry, { type: 'annotations.unanchor', ids: mine });
      }
      publish();
    },
    focus(ids) {
      for (const entry of entries.values()) send(entry, { type: 'highlights.focus', ids });
    },
    scrollTo(id) {
      for (const entry of entries.values()) {
        if (entry.asked.has(id)) send(entry, { type: 'scroll.to', id });
      }
    },
    clearSelection() {
      // The guest whose selection it is; every guest when none is known.
      const owner = selectionOwner === undefined ? undefined : entries.get(selectionOwner);
      selectionOwner = undefined;
      selection.value = undefined;
      for (const entry of owner ? [owner] : entries.values()) {
        send(entry, { type: 'selection.clear' });
      }
    },
    onActivate(handler) {
      activateHandlers.add(handler);
      return () => activateHandlers.delete(handler);
    },
    close() {
      closed = true;
      win.removeEventListener('message', onWindowMessage);
      for (const entry of [...entries.values()]) drop(entry);
      publish();
    },
  };
}
