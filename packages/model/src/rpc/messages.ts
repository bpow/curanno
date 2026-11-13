/**
 * The guest/sidebar RPC protocol (ADR 0007): every message that crosses
 * the boundary between the in-page guest and the sidebar iframe, as plain
 * JSON objects sent over `postMessage`. Specified in
 * docs/guest-sidebar-rpc.md; this file is the contract both sides compile
 * against. Nothing here carries a body, a tag, a creator or a token: the
 * guest sees annotation identifiers and selectors only.
 */
import type { AnchoringState, OneOrMany, SpecificResource, Target } from '../annotation/types.js';
import type { DocumentUriRelation } from '../document-identity/identity.js';
import type { TextRange } from '../text-model/selectors.js';

/** Identifies the protocol in every message, so unrelated `postMessage` traffic is ignored. */
export const RPC_PROTOCOL = 'curanno/guest-sidebar';

/**
 * Bumped for any change a peer of the previous version could not handle.
 * Additive optional fields do not bump it. Version 2: guests in other
 * frames connect to the sidebar directly instead of through the host
 * (ADR 0024).
 */
export const RPC_PROTOCOL_VERSION = 2;

/** Fields present on every message. */
export interface RpcEnvelope {
  protocol: typeof RPC_PROTOCOL;
  version: number;
}

// ---------------------------------------------------------------------------
// Discovery: window-level messages exchanged before the port exists

/**
 * Sent by the sidebar, with target origin `*`, once its message handler is
 * installed: to `window.parent`, and to every frame of the top page, again
 * at intervals so that frames loaded later hear it too. A guest accepts it
 * only when the event's origin is the sidebar origin it was configured
 * with, and answers `guest.connect` to the event's source. It carries
 * nothing a page could use.
 */
export interface SidebarReadyMessage extends RpcEnvelope {
  type: 'sidebar.ready';
  /**
   * Random per sidebar load. A guest connected to this instance ignores
   * the repeats; a new one (the sidebar reloaded) makes it connect again.
   */
  instance: string;
}

/**
 * Sent by a guest to the sidebar's window, with the sidebar's origin as
 * target origin so that only a window on that origin receives it, in reply
 * to `sidebar.ready`. Transfers one `MessagePort`; all further messages of
 * that guest travel over it. The sidebar takes the guest's origin from the
 * event and its role from the sender: `window.parent` is the host, another
 * frame of the same top page is a sub-frame guest.
 */
export interface GuestConnectMessage extends RpcEnvelope {
  type: 'guest.connect';
  /** Distinguishes guests when one sidebar serves several frames. */
  guestId: string;
}

export type WindowMessage = SidebarReadyMessage | GuestConnectMessage;

// ---------------------------------------------------------------------------
// Payload types

/** How the guest draws highlights, for the sidebar's information only. */
export type HighlightTechnique = 'css-highlight' | 'overlay';

/** Where the guest runs: the frame holding the sidebar, or another frame of the page. */
export type GuestRole = 'host' | 'sub';

export interface GuestCapabilities {
  highlights: HighlightTechnique;
  /** Answers `text.request` (ADR 0033). Guests built before it leave this out. */
  text?: boolean;
}

/** One identifier the page exposes, as `POST /x/documents` takes it. */
export interface DocumentLink {
  /** Exactly as found in the page (docs/document-identity.md, section 8). */
  uri: string;
  relation: DocumentUriRelation;
}

/** The identity of the page the guest runs in. */
export interface GuestDocument {
  /** The page's own URL. */
  uri: string;
  title?: string;
  /** Every identifier found in the page, the page URL first. */
  links: DocumentLink[];
}

/** A selection the user made in the page, described per the text model. */
export interface GuestSelection {
  /** The page as `source`, with the selectors for the selected range. */
  target: SpecificResource;
  /** The selected text, for display in the sidebar only. */
  quote: string;
}

/** What the sidebar asks the guest to anchor: an annotation's identifier and targets. */
export interface AnchorRequest {
  /** The annotation IRI. */
  id: string;
  /**
   * The targets to anchor, which may be the annotation's own or a repair's
   * (ADR 0010); the guest does not know the difference.
   */
  target: OneOrMany<Target>;
  /** `suggested`: a suggestion not saved yet, drawn apart from annotations (ADR 0033). */
  style?: 'suggested';
}

/** The states a guest reports; `repaired` is the sidebar's to apply. */
export type GuestAnchoringState = Exclude<AnchoringState, 'repaired'>;

export type AnchorVia = 'range' | 'position' | 'quote';

/** The result for one target of an annotation. */
export type TargetAnchoringResult =
  | {
      state: 'anchored';
      /** Code point offsets in the scope's text (ADR 0012), absent for a whole-page target. */
      range?: TextRange;
      via?: AnchorVia;
      /** 1 for a selector that matched exactly; a quote match's score otherwise. */
      score?: number;
      /**
       * For a PDF target: the page the text was found on, when it is not
       * the page the selector names (the text moved in a revised file).
       */
      page?: number;
    }
  | { state: 'ambiguous'; candidates: TextRange[] }
  | { state: 'orphaned'; reason: string };

export interface AnchoringResult {
  /** The annotation IRI from the request. */
  id: string;
  /** `anchored` when any target anchored, else `ambiguous` when any was, else `orphaned`. */
  state: GuestAnchoringState;
  /** One entry per target, in the request's order. */
  targets: TargetAnchoringResult[];
}

/**
 * The text of one text-model scope (ADR 0033): the body of a page, or one
 * page of a PDF.
 */
export interface GuestScopeText {
  /** The scope's normalized text (text model, sections 4–7). */
  text: string;
  /** Code point offsets where blocks begin, for readers of the text; selectors never use them. */
  blockStarts?: number[];
  /** The 1-based PDF page the scope is; absent for a page's body. */
  page?: number;
}

// ---------------------------------------------------------------------------
// Port messages from the guest to the sidebar

export interface GuestHelloMessage extends RpcEnvelope {
  type: 'guest.hello';
  guestId: string;
  capabilities: GuestCapabilities;
}

/** The page's identity, sent after the handshake and whenever it changes. */
export interface DocumentReportMessage extends RpcEnvelope {
  type: 'document.report';
  document: GuestDocument;
}

/**
 * Results for annotations the sidebar asked to anchor: after each request
 * and, after the page changes, for the annotations whose result changed.
 */
export interface AnchoringResultsMessage extends RpcEnvelope {
  type: 'anchoring.results';
  results: AnchoringResult[];
}

/** The user's selection changed; `null` when it was cleared. */
export interface SelectionChangedMessage extends RpcEnvelope {
  type: 'selection.changed';
  selection: GuestSelection | null;
}

/** The pointer is over these annotations' highlights (empty when it left). */
export interface HighlightsHoveredMessage extends RpcEnvelope {
  type: 'highlights.hovered';
  ids: string[];
}

/** The user clicked a highlight; every annotation under the pointer is listed. */
export interface HighlightsActivatedMessage extends RpcEnvelope {
  type: 'highlights.activated';
  ids: string[];
}

/** The sidebar frame was shown or hidden, by whichever side asked. */
export interface SidebarVisibilityMessage extends RpcEnvelope {
  type: 'sidebar.visibility';
  open: boolean;
}

/** The document's text, answering the `text.request` with the same id. */
export interface TextReportMessage extends RpcEnvelope {
  type: 'text.report';
  requestId: string;
  scopes: GuestScopeText[];
}

export interface GuestErrorMessage extends RpcEnvelope {
  type: 'guest.error';
  message: string;
  /** The `type` of the sidebar message that failed, when one did. */
  inReplyTo?: string;
}

export type GuestMessage =
  | GuestHelloMessage
  | DocumentReportMessage
  | AnchoringResultsMessage
  | SelectionChangedMessage
  | HighlightsHoveredMessage
  | HighlightsActivatedMessage
  | SidebarVisibilityMessage
  | TextReportMessage
  | GuestErrorMessage;

// ---------------------------------------------------------------------------
// Port messages from the sidebar to the guest

/** Acknowledges `guest.hello`; the sidebar may send requests from then on. */
export interface SidebarHelloMessage extends RpcEnvelope {
  type: 'sidebar.hello';
}

/** Anchor and highlight these annotations, replacing earlier results for the same IRIs. */
export interface AnnotationsAnchorMessage extends RpcEnvelope {
  type: 'annotations.anchor';
  requests: AnchorRequest[];
}

/** Remove highlights and results for these annotation IRIs. */
export interface AnnotationsUnanchorMessage extends RpcEnvelope {
  type: 'annotations.unanchor';
  ids: string[];
}

/** Emphasise these annotations' highlights (sidebar hover); empty clears. */
export interface HighlightsFocusMessage extends RpcEnvelope {
  type: 'highlights.focus';
  ids: string[];
}

/** Show or hide every highlight; the guest keeps them and stops hit-testing while hidden. */
export interface HighlightsVisibleMessage extends RpcEnvelope {
  type: 'highlights.visible';
  visible: boolean;
}

/** Scroll the page to the annotation's first highlight. */
export interface ScrollToMessage extends RpcEnvelope {
  type: 'scroll.to';
  id: string;
}

/** Drop the current selection, typically after an annotation was created from it. */
export interface SelectionClearMessage extends RpcEnvelope {
  type: 'selection.clear';
}

/** Report the document's text; sent only to a guest whose capabilities include `text`. */
export interface TextRequestMessage extends RpcEnvelope {
  type: 'text.request';
  requestId: string;
}

export interface SidebarOpenMessage extends RpcEnvelope {
  type: 'sidebar.open';
}

export interface SidebarCloseMessage extends RpcEnvelope {
  type: 'sidebar.close';
}

export interface SidebarToggleMessage extends RpcEnvelope {
  type: 'sidebar.toggle';
}

export interface SidebarErrorMessage extends RpcEnvelope {
  type: 'sidebar.error';
  message: string;
  inReplyTo?: string;
}

export type SidebarMessage =
  | SidebarHelloMessage
  | AnnotationsAnchorMessage
  | AnnotationsUnanchorMessage
  | HighlightsFocusMessage
  | HighlightsVisibleMessage
  | ScrollToMessage
  | SelectionClearMessage
  | TextRequestMessage
  | SidebarOpenMessage
  | SidebarCloseMessage
  | SidebarToggleMessage
  | SidebarErrorMessage;

export type RpcMessage = WindowMessage | GuestMessage | SidebarMessage;

/** A message without its envelope, as callers build it. Distributes over unions. */
export type Payload<M extends RpcEnvelope> = M extends RpcEnvelope
  ? Omit<M, keyof RpcEnvelope>
  : never;

/** Add the envelope to a message payload. */
export function envelope<M extends RpcEnvelope>(payload: Payload<M>): M {
  return { protocol: RPC_PROTOCOL, version: RPC_PROTOCOL_VERSION, ...payload } as unknown as M;
}
