/**
 * A document integration adapts the guest to one kind of document: an HTML
 * page, whose text is in the DOM, or a PDF in a PDF.js viewer, whose text
 * arrives one page at a time (ADR 0007: the guest, not the sidebar, knows
 * the document). The guest owns the requests, results and highlights; the
 * integration answers where text is and when it changed.
 */
import type {
  GuestDocument,
  GuestScopeText,
  Selector,
  TargetAnchoringResult,
} from '@curanno/model';

/** What anchoring one target produced: the result to report and the ranges to draw. */
export interface AnchoredTarget {
  result: TargetAnchoringResult;
  /** Empty when the text is not in the DOM (a PDF page not rendered yet). */
  ranges: Range[];
}

/** A target's selectors with what anchoring them produced. */
export interface AnchoredTargetSelectors {
  selectors: Selector[];
  result: TargetAnchoringResult;
}

/** A user selection described per the text model, ready for `selection.changed`. */
export interface DescribedSelection {
  selectors: Selector[];
  quote: string;
}

export interface DocumentIntegration {
  /** Holds the annotatable content; observers and hit testing are scoped to it. */
  readonly root: Element;
  /** The IRI a target of this document names as `source`. */
  source(): string;
  /** The document's identity for `document.report`. */
  document(): Promise<GuestDocument>;
  /** The text of every scope, for `text.report` (ADR 0033). */
  text(): Promise<GuestScopeText[]>;
  /** Called before a batch of `anchor` calls; integrations refresh what they cache. */
  prepare(): void;
  /** Anchor one target's selectors. */
  anchor(selectors: Selector[]): Promise<AnchoredTarget>;
  /** The selectors and quote for a DOM range, or undefined when it covers no text. */
  describe(range: Range): DescribedSelection | undefined;
  /** Scroll to a highlight, or towards where it would be when none is drawn. */
  scrollTo(ranges: Range[], targets: AnchoredTargetSelectors[]): void;
  /**
   * Watch the document; `onChange` asks the guest to re-anchor everything
   * and report what changed. Returns the function that stops watching.
   */
  observe(onChange: () => void): () => void;
  destroy(): void;
}
