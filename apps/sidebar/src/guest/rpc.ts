/**
 * The sidebar's end of the guest/sidebar RPC protocol
 * (docs/guest-sidebar-rpc.md, ADR 0007): discovery over window messages,
 * then one `MessagePort` per guest, transferred with `guest.connect`. The
 * sidebar announces itself with `sidebar.ready` to its parent and to every
 * frame of the top page, and each guest sends its own `guest.connect`.
 * Whose guest it is comes from the browser, never from the message (ADR
 * 0024): the origin is the event's, and the role is the sender's, the host
 * for `window.parent` and a sub-frame guest for another frame of the same
 * top page. Nothing here carries a token, a body, a tag or a creator in
 * either direction: the protocol has no field for them.
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
 * of the user's annotations on it. Its document's annotations reach it only
 * as `disclosure.ts` allows: those made on another origin are withheld
 * unless anyone may read them or the user allowed that origin (ADR 0025).
 */
import {
  RPC_PROTOCOL_VERSION,
  envelope,
  framesBelow,
  isFrameOf,
  parseGuestMessage,
  parseWindowMessage,
  type AnchoringState,
  type FrameWindow,
  type GuestMessage,
  type GuestScopeText,
  type GuestRole,
  type Payload,
  type SidebarErrorMessage,
  type SidebarMessage,
  type SidebarReadyMessage,
} from '@curanno/model';
import { shallowReadonly, shallowRef, type Ref } from 'vue';
import { createSessionConsent, foreignSources, originKey, type ConsentStore } from './disclosure';
import type { AnchorRequest, DocumentSelection, Guest, GuestDocument, Withheld } from './types';

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
  /** The page's top window, through which the sidebar reaches the page's frames. */
  top: FrameWindow | null;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

export interface RpcGuestOptions {
  /** The sidebar's window. Default the global one. */
  window?: WindowLike;
  /** Origins whose guests may report a document on another origin: the PDF viewer's. */
  trustedOrigins?: readonly string[];
  /**
   * How often `sidebar.ready` is repeated to the page's frames, for guests
   * that start later, and frames that went away are forgotten. Default 1 s.
   */
  announceIntervalMs?: number;
  /**
   * How long `requestText` waits for the guest's report. Default 5 min: a PDF reads out every
   * page first, and the curator can stop a run that is waiting.
   */
  textTimeoutMs?: number;
  /** Which origins' annotations the user allowed on which pages. Default: the session's. */
  consent?: ConsentStore;
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
  /** The window the guest connected from. */
  source: unknown;
  origin: string;
  role: GuestRole;
  port: PortLike;
  listener: (event: { data: unknown }) => void;
  connected: boolean;
  /** Whether the guest said it answers `text.request`. */
  text: boolean;
  document: GuestDocument | undefined;
  /** Results this guest reported, by IRI. */
  anchoring: Map<string, AnchoringState>;
  /** IRIs this guest was asked to anchor. */
  asked: Set<string>;
  /** IRIs kept from this guest, with the origin they were made on. */
  withheld: Map<string, string>;
  hovered: string[];
}

interface PendingText {
  entry: GuestEntry;
  resolve: (scopes: GuestScopeText[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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
  const consent = options.consent ?? createSessionConsent();
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
  const withheld = shallowRef<ReadonlyMap<string, Withheld>>(new Map());
  const highlightsVisible = shallowRef(true);
  const textDocuments = shallowRef<ReadonlySet<string>>(new Set());
  /** Text requests awaiting their report, by request id. */
  const pendingText = new Map<string, PendingText>();
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
    textDocuments.value = new Set(
      list.flatMap((e) => (e.connected && e.text && e.document ? [e.document.uri] : [])),
    );
    const merged = new Map<string, AnchoringState>();
    for (const e of list) {
      for (const [id, state] of e.anchoring) {
        const current = merged.get(id);
        if (!current || STATE_RANK[state] > STATE_RANK[current]) merged.set(id, state);
      }
    }
    anchoring.value = merged;
    hovered.value = [...new Set(list.flatMap((e) => e.hovered))];
    // Kept from some page and shown on none.
    const kept = new Map<string, Withheld>();
    for (const e of list) {
      for (const [id, source] of e.withheld) {
        if (!kept.has(id) && !list.some((other) => other.asked.has(id))) {
          kept.set(id, { pageOrigin: e.origin, source });
        }
      }
    }
    withheld.value = kept;
  }

  function requestsFor(uri: string): AnchorRequest[] {
    return [...requestsForAll.values(), ...(requestsByDocument.get(uri)?.values() ?? [])];
  }

  /**
   * The origin that keeps `request` from `entry`, or undefined when the
   * guest may be sent it: every target is on the guest's origin, anyone may
   * read the annotation, the guest is trusted, or the user allowed it.
   */
  function blockedBy(entry: GuestEntry, request: AnchorRequest): string | undefined {
    if (request.public === true || trusted.includes(entry.origin)) return undefined;
    const pageKey = originKey(entry.origin);
    return foreignSources(request.target, pageKey).find(
      (source) => pageKey === null || !consent.has(pageKey, source),
    );
  }

  /** Send a guest the requests for its document that it may have; nothing before it reports one. */
  function sendRequests(entry: GuestEntry, requests: AnchorRequest[]): void {
    if (requests.length === 0) return;
    const allowed: AnchorRequest[] = [];
    const revoked: string[] = [];
    for (const request of requests) {
      const source = blockedBy(entry, request);
      if (source === undefined) {
        entry.withheld.delete(request.id);
        entry.asked.add(request.id);
        // The protocol's request only: whether it is public is the sidebar's business.
        allowed.push({
          id: request.id,
          target: request.target,
          ...(request.style ? { style: request.style } : {}),
        });
      } else {
        entry.withheld.set(request.id, source);
        // One that may no longer go, say because it stopped being public, takes its highlight along.
        if (entry.asked.delete(request.id)) {
          entry.anchoring.delete(request.id);
          revoked.push(request.id);
        }
      }
    }
    if (revoked.length) send(entry, { type: 'annotations.unanchor', ids: revoked });
    if (allowed.length) send(entry, { type: 'annotations.anchor', requests: allowed });
  }

  function settleText(id: string): PendingText | undefined {
    const pending = pendingText.get(id);
    if (!pending) return undefined;
    pendingText.delete(id);
    clearTimeout(pending.timer);
    return pending;
  }

  function drop(entry: GuestEntry): void {
    for (const [id, pending] of [...pendingText]) {
      if (pending.entry === entry) settleText(id)?.reject(new Error('the page went away'));
    }
    entry.port.removeEventListener('message', entry.listener);
    entry.port.close();
    entries.delete(entry.id);
    if (selectionOwner === entry.id) {
      selectionOwner = undefined;
      selection.value = undefined;
    }
  }

  /** Who sent a window message, as the browser reports it; nothing in the message counts. */
  function roleOf(source: unknown): GuestRole | undefined {
    if (source === win.parent) return 'host';
    // Only the top page's sidebar serves other frames, and only frames of that page.
    if (win.top && win.parent === win.top && source !== win && isFrameOf(source, win.top)) {
      return 'sub';
    }
    return undefined;
  }

  function onWindowMessage(event: MessageEventLike): void {
    if (closed) return;
    const role = roleOf(event.source);
    if (!role) return;
    const message = parseWindowMessage(event.data);
    if (message?.type !== 'guest.connect') return;
    const next = event.ports[0];
    if (!next) return;
    if (message.version !== RPC_PROTOCOL_VERSION) {
      error(next, `unsupported protocol version ${message.version}`, message.type);
      next.close();
      return;
    }
    // One guest per frame: a connect from a window that has one (reloaded or navigated) replaces it.
    for (const entry of [...entries.values()]) {
      if (entry.id === message.guestId || entry.source === event.source) drop(entry);
    }
    const origin = event.origin;
    const entry: GuestEntry = {
      id: message.guestId,
      source: event.source,
      origin,
      role,
      port: next,
      listener: (e) => onPortMessage(entry, e.data),
      connected: false,
      text: false,
      document: undefined,
      anchoring: new Map(),
      asked: new Set(),
      withheld: new Map(),
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
      if (!highlightsVisible.value)
        post(entry.port, { type: 'highlights.visible', visible: false });
      entry.connected = true;
      entry.text = message.capabilities.text === true;
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
        entry.withheld.clear();
        sendRequests(entry, requestsFor(uri));
        publish();
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
      case 'text.report':
        // Only the guest that was asked can answer.
        if (pendingText.get(message.requestId)?.entry === entry) {
          settleText(message.requestId)?.resolve(message.scopes);
        }
        break;
      case 'guest.error':
        console.warn(`[guest ${entry.id}] ${message.message}`, message.inReplyTo ?? '');
        break;
    }
  }

  const ready = envelope<SidebarReadyMessage>({ type: 'sidebar.ready', instance: randomId() });

  /** Tell the page's other frames, so that their guests connect; the top page's sidebar only. */
  function announce(): void {
    if (!win.top || win.parent !== win.top) return;
    for (const frame of framesBelow(win.top)) {
      if (frame === (win as unknown)) continue;
      try {
        frame.postMessage(ready, '*');
      } catch {
        // A frame mid-navigation; the next round reaches it.
      }
    }
  }

  /** Forget guests whose frame went away. */
  function sweep(): void {
    const gone = [...entries.values()].filter((entry) => isClosed(entry.source));
    for (const entry of gone) drop(entry);
    if (gone.length) publish();
  }

  win.addEventListener('message', onWindowMessage);
  win.parent.postMessage(ready, '*');
  announce();
  const timer = setInterval(() => {
    sweep();
    announce();
  }, options.announceIntervalMs ?? 1000);

  return {
    document: shallowReadonly(document),
    documents: shallowReadonly(documents),
    selection: shallowReadonly(selection),
    anchoring: shallowReadonly(anchoring),
    hovered: shallowReadonly(hovered),
    withheld: shallowReadonly(withheld),
    highlightsVisible: shallowReadonly(highlightsVisible),
    textDocuments: shallowReadonly(textDocuments),
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
      publish();
    },
    requestText(documentUri) {
      const entry = ordered().find((e) => e.connected && e.text && e.document?.uri === documentUri);
      if (!entry) return Promise.resolve(undefined);
      const requestId = randomId();
      return new Promise<GuestScopeText[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          settleText(requestId)?.reject(new Error('the page did not report its text'));
        }, options.textTimeoutMs ?? 300_000);
        pendingText.set(requestId, { entry, resolve, reject, timer });
        send(entry, { type: 'text.request', requestId });
      });
    },
    unanchor(ids) {
      for (const id of ids) {
        requestsForAll.delete(id);
        for (const bucket of requestsByDocument.values()) bucket.delete(id);
      }
      for (const entry of entries.values()) {
        for (const id of ids) entry.withheld.delete(id);
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
      // Each guest hears only of annotations it was sent.
      for (const entry of entries.values()) {
        send(entry, { type: 'highlights.focus', ids: ids.filter((id) => entry.asked.has(id)) });
      }
    },
    showHighlights(visible) {
      highlightsVisible.value = visible;
      for (const entry of entries.values()) send(entry, { type: 'highlights.visible', visible });
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
    allow(pageOrigin, source) {
      const pageKey = originKey(pageOrigin);
      if (pageKey === null) return;
      consent.add(pageKey, source);
      for (const entry of entries.values()) {
        if (!entry.document || originKey(entry.origin) !== pageKey) continue;
        const kept = requestsFor(entry.document.uri).filter((r) => entry.withheld.has(r.id));
        sendRequests(entry, kept);
      }
      publish();
    },
    onActivate(handler) {
      activateHandlers.add(handler);
      return () => activateHandlers.delete(handler);
    },
    close() {
      closed = true;
      clearInterval(timer);
      win.removeEventListener('message', onWindowMessage);
      for (const entry of [...entries.values()]) drop(entry);
      publish();
    },
  };
}

function isClosed(source: unknown): boolean {
  try {
    return (source as { closed?: boolean }).closed === true;
  } catch {
    return true;
  }
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
