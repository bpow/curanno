/**
 * Everything the sidebar needs from the in-page guests (ADR 0007). A guest
 * sees selectors and annotation identifiers only: no bodies, tags, authors
 * or tokens cross this boundary in either direction. One sidebar serves the
 * page's host frame and any other frames with guests of their own, each
 * with a document of its own; this interface merges them. The document,
 * selection and request shapes are the RPC protocol's own (`@curanno/model`,
 * `rpc/`), which `rpc.ts` speaks over postMessage; the fake in `fake.ts`
 * serves development and tests.
 */
import type { AnchoringState } from '@curanno/model';
import type { Ref } from 'vue';

export type { DocumentLink, GuestDocument, GuestSelection } from '@curanno/model';
import type {
  AnchorRequest as WireAnchorRequest,
  GuestDocument,
  GuestSelection,
} from '@curanno/model';

/**
 * What the sidebar asks to be anchored: the protocol's request, which is
 * all a guest is sent, and whether anyone may read the annotation, which
 * decides where it may be sent (ADR 0025).
 */
export interface AnchorRequest extends WireAnchorRequest {
  public?: boolean;
}

/** An annotation kept from a page because it was made on another origin (ADR 0025). */
export interface Withheld {
  /** The page's origin, as the browser reported it. */
  pageOrigin: string;
  /** The host of the page the annotation was made on, or its source if not a web page. */
  source: string;
}

/** A selection with the document of the frame it was made in. */
export interface DocumentSelection extends GuestSelection {
  document: GuestDocument;
}

export interface Guest {
  /** The host frame's document (the page itself); undefined until it is reported. */
  readonly document: Readonly<Ref<GuestDocument | undefined>>;
  /** Every connected guest's document, the host's first, one entry per URI. */
  readonly documents: Readonly<Ref<readonly GuestDocument[]>>;
  /** The current selection in any frame, cleared by its guest when the user deselects. */
  readonly selection: Readonly<Ref<DocumentSelection | undefined>>;
  /** Live anchoring results by annotation IRI, the best state over the frames showing it. */
  readonly anchoring: Readonly<Ref<ReadonlyMap<string, AnchoringState>>>;
  /** Annotation IRIs whose highlights the pointer is over, in any frame. */
  readonly hovered: Readonly<Ref<readonly string[]>>;
  /** Annotations not sent to a page that shows their document, by IRI (ADR 0025). */
  readonly withheld: Readonly<Ref<ReadonlyMap<string, Withheld>>>;

  /**
   * Asks the guests showing `documentUri` (every guest when omitted) to
   * anchor and highlight these annotations. Replaces earlier results for the
   * same IRIs, and reaches guests that report the document later.
   */
  anchor(requests: AnchorRequest[], documentUri?: string): void;
  /** Removes highlights and results for these annotation IRIs everywhere. */
  unanchor(ids: string[]): void;
  /** Emphasises these annotations' highlights in the page (sidebar hover). */
  focus(ids: string[]): void;
  /** Scrolls the frame showing the annotation to its first highlight. */
  scrollTo(id: string): void;
  clearSelection(): void;
  /**
   * Lets pages on `pageOrigin` be sent the annotations made on `source`,
   * for this session, and sends those withheld until now.
   */
  allow(pageOrigin: string, source: string): void;
  /**
   * Called when the user clicks a highlight in a page. The sidebar scrolls
   * to and expands the matching card. Returns an unsubscribe function.
   */
  onActivate(handler: (ids: string[]) => void): () => void;
}
