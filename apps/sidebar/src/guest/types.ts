/**
 * Everything the sidebar needs from the in-page guest (ADR 0007). The guest
 * sees selectors and annotation identifiers only: no bodies, tags, authors or
 * tokens cross this boundary in either direction. The document, selection
 * and request shapes are the RPC protocol's own (`@scale/model`, `rpc/`),
 * which `rpc.ts` speaks over postMessage; the fake in `fake.ts` serves
 * development and tests.
 */
import type { AnchoringState } from '@scale/model';
import type { Ref } from 'vue';

export type { AnchorRequest, DocumentLink, GuestDocument, GuestSelection } from '@scale/model';
import type { AnchorRequest, GuestDocument, GuestSelection } from '@scale/model';

export interface Guest {
  /** Undefined until the guest has reported the page. */
  readonly document: Readonly<Ref<GuestDocument | undefined>>;
  /** The current selection, cleared by the guest when the user deselects. */
  readonly selection: Readonly<Ref<GuestSelection | undefined>>;
  /** Live anchoring results by annotation IRI, from the most recent `anchor()`. */
  readonly anchoring: Readonly<Ref<ReadonlyMap<string, AnchoringState>>>;
  /** Annotation IRIs whose highlights the pointer is over in the page. */
  readonly hovered: Readonly<Ref<readonly string[]>>;

  /** Asks the guest to anchor and highlight these annotations. Replaces earlier results for the same IRIs. */
  anchor(requests: AnchorRequest[]): void;
  /** Removes highlights and results for these annotation IRIs. */
  unanchor(ids: string[]): void;
  /** Emphasises these annotations' highlights in the page (sidebar hover). */
  focus(ids: string[]): void;
  /** Scrolls the page to the annotation's first highlight. */
  scrollTo(id: string): void;
  clearSelection(): void;
  /**
   * Called when the user clicks a highlight in the page. The sidebar scrolls
   * to and expands the matching card. Returns an unsubscribe function.
   */
  onActivate(handler: (ids: string[]) => void): () => void;
}
