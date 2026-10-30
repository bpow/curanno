/**
 * Everything the sidebar needs from the in-page guest (ADR 0007). The guest
 * sees selectors and annotation identifiers only: no bodies, tags, authors or
 * tokens cross this boundary in either direction. The real implementation
 * speaks the postMessage RPC whose message types live in `@scale/model`
 * (see TODO.md); the fake in `fake.ts` serves development and tests.
 */
import type { components } from '@scale/api-client';
import type { AnchoredTarget, AnchoringState, OneOrMany, Target } from '@scale/model';
import type { Ref } from 'vue';

export type DocumentLink = components['schemas']['DocumentLink'];

/** The identity of the page the guest runs in (docs/document-identity.md). */
export interface GuestDocument {
  /** The page's own URL. */
  uri: string;
  title?: string;
  /** Equivalent identifiers found in the page, for `registerDocument`. */
  links: DocumentLink[];
}

/** A selection the user made in the page, described per the text model. */
export interface GuestSelection {
  /** The target to annotate: the page as source with the selectors describing the range. */
  target: AnchoredTarget;
  /** The selected text, for display in the sidebar only. */
  quote: string;
}

/** What the sidebar hands the guest to anchor: an annotation's identifier and targets. */
export interface AnchorRequest {
  /** The annotation IRI. */
  id: string;
  target: OneOrMany<Target>;
}

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
