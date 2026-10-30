/**
 * The HTML page integration: one anchoring scope over the root (the body
 * by default), re-extracted before every anchoring pass, and a mutation
 * observer that asks for a pass whenever the page changes.
 */
import type { Selector } from '@scale/model';
import { anchor, type AnchorOptions } from '../anchoring/anchor.js';
import { createScope, domRangeOf, type AnchoringScope } from '../anchoring/scope.js';
import { collectDocument } from '../document-metadata.js';
import { GUEST_ATTRIBUTE } from '../highlights/types.js';
import { observeMutations } from '../observers/mutation.js';
import { describeSelection } from './selection.js';
import type { AnchoredTarget, DocumentIntegration } from './types.js';

export interface HtmlIntegrationOptions {
  document?: Document;
  /** Anchoring root. Default `document.body`. */
  root?: Element;
  anchoring?: AnchorOptions;
  mutationDebounceMs?: number;
}

export function isGuestOwned(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element !== null && element.closest(`[${GUEST_ATTRIBUTE}]`) !== null;
}

export class HtmlIntegration implements DocumentIntegration {
  readonly root: Element;
  private readonly doc: Document;
  private readonly options: HtmlIntegrationOptions;
  private scope: AnchoringScope | undefined;

  constructor(options: HtmlIntegrationOptions = {}) {
    this.options = options;
    this.doc = options.document ?? document;
    this.root = options.root ?? this.doc.body;
  }

  source(): string {
    return this.doc.location.href;
  }

  document(): Promise<ReturnType<typeof collectDocument>> {
    return Promise.resolve(collectDocument(this.doc));
  }

  prepare(): void {
    this.scope = createScope(this.root);
  }

  private currentScope(): AnchoringScope {
    this.scope ??= createScope(this.root);
    return this.scope;
  }

  anchor(selectors: Selector[]): Promise<AnchoredTarget> {
    return Promise.resolve(anchorInScope(this.currentScope(), selectors, this.options.anchoring));
  }

  describe(range: Range) {
    return describeSelection(this.currentScope(), range);
  }

  scrollTo(ranges: Range[]): void {
    // Everything an HTML page anchors is in the DOM, so there is always a range.
    const element = ranges[0]?.startContainer.parentElement;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  observe(onChange: () => void): () => void {
    return observeMutations(this.root, {
      isOwned: isGuestOwned,
      onChange: () => {
        this.scope = undefined;
        onChange();
      },
      ...(this.options.mutationDebounceMs !== undefined
        ? { debounceMs: this.options.mutationDebounceMs }
        : {}),
    });
  }

  destroy(): void {
    this.scope = undefined;
  }
}

/**
 * Anchor text selectors in a scope and, when the scope is live DOM, resolve
 * the range to draw. A target without text selectors covers the whole
 * document and anchors with no range.
 */
export function anchorInScope<N>(
  scope: AnchoringScope<N>,
  selectors: Selector[],
  options: AnchorOptions = {},
): AnchoredTarget {
  if (selectors.length === 0) return { result: { state: 'anchored' }, ranges: [] };
  const result = anchor(scope, selectors, options);
  if (result.state === 'anchored') {
    const dom = isLiveScope(scope) ? domRangeOf(scope, result.range) : undefined;
    return {
      result: { state: 'anchored', range: result.range, via: result.via, score: result.score },
      ranges: dom ? [dom] : [],
    };
  }
  if (result.state === 'ambiguous') {
    return { result: { state: 'ambiguous', candidates: result.candidates }, ranges: [] };
  }
  return { result: { state: 'orphaned', reason: result.reason }, ranges: [] };
}

function isLiveScope<N>(scope: AnchoringScope<N>): scope is AnchoringScope<N> & AnchoringScope {
  const root = scope.root as unknown;
  return typeof root === 'object' && root !== null && 'children' in (root as Element);
}
