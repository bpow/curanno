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

export type { AnchorRequest, DocumentLink, GuestDocument, GuestSelection } from '@curanno/model';
import type { AnchorRequest, GuestDocument, GuestSelection } from '@curanno/model';

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
   * Called when the user clicks a highlight in a page. The sidebar scrolls
   * to and expands the matching card. Returns an unsubscribe function.
   */
  onActivate(handler: (ids: string[]) => void): () => void;
}
