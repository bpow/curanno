/**
 * The text model walks a tree of nodes without depending on any particular
 * DOM implementation. A host (the guest in a browser, a test harness over a
 * DOM library, an importer over a parser's tree) supplies an adapter that
 * answers structural questions about its nodes.
 *
 * `N` is the host's node type. Positions handed to and returned by the model
 * refer to text nodes of that type with UTF-16 offsets, matching how DOM
 * `Range` boundary points work, so that conversion at the guest boundary is a
 * lookup rather than a re-count.
 */
export type NodeKind = 'element' | 'text' | 'other';

export interface TextTreeAdapter<N> {
  kind(node: N): NodeKind;
  /** Lower-case local name of an element. Only called for elements. */
  tagName(node: N): string;
  /** Attribute value, or null when absent. Only called for elements. */
  attribute(node: N, name: string): string | null;
  children(node: N): Iterable<N>;
  /** Character data of a text node. Only called for text nodes. */
  textData(node: N): string;
  /**
   * Computed `display` value when the host knows it (a browser does, a bare
   * parser does not). Return null to fall back to the markup rules in the
   * specification: the `hidden` attribute, `aria-hidden`, excluded elements
   * and an inline `style` attribute.
   */
  display?(node: N): string | null;
  /**
   * Computed `white-space` value when the host knows it. Return null to fall
   * back to the markup rules: preformatted elements and inline `style`.
   */
  whiteSpace?(node: N): string | null;
}

/** A boundary point: a text node and a UTF-16 offset into its data. */
export interface TextPoint<N> {
  node: N;
  offset: number;
}
