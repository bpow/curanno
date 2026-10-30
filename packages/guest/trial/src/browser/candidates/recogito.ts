/**
 * Recogito Text Annotator, driven through its public `createTextAnnotator`
 * so the trial exercises the real loading path (adapter, revive, store).
 *
 * `recogito-default` uses the bundled W3C adapter and position-only revival.
 * `recogito-quote` uses our adapter and a `selectorReviveFn` that accepts a
 * position hit only when its text still equals the quote and otherwise falls
 * back to fuzzy quote matching with prefix and suffix.
 */
import {
  createTextAnnotator,
  NOT_ANNOTATABLE_SELECTOR,
  reviveTextSelector,
  W3CTextFormat,
  type RevivedTextSelectorLike,
  type TextAnnotator,
  type TextAnnotationLike,
} from '@recogito/text-annotator';
import type { Selector } from '../../corpus.ts';
import { matchQuote, type MatchOptions } from '../match-quote.ts';
import {
  createW3CQuoteAdapter,
  type QuoteAnnotation,
  type QuoteSelector,
  type W3CAnnotation,
} from '../recogito-w3c-adapter.ts';
import { rangeToSpan } from '../text.ts';
import type { AnchorResult, Candidate } from './types.ts';

function toW3C(id: string, selectors: Selector[]) {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id,
    type: 'Annotation' as const,
    body: [],
    target: { source: location.href, selector: selectors },
  };
}

/**
 * Text of `container` as Recogito counts it: text nodes in document order,
 * skipping `.not-annotatable` subtrees. Offsets into this string are what
 * `reviveTextSelector` expects.
 */
function annotatableText(container: HTMLElement): string {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, (n) =>
    n.parentElement?.closest(NOT_ANNOTATABLE_SELECTOR)
      ? NodeFilter.FILTER_SKIP
      : NodeFilter.FILTER_ACCEPT,
  );
  let text = '';
  let node = walker.nextNode();
  while (node) {
    text += (node as Text).data;
    node = walker.nextNode();
  }
  return text;
}

type RevivedQuoteSelector = RevivedTextSelectorLike & { via?: string; score?: number };

export function quoteReviveFn(minScore: number) {
  return (selector: QuoteSelector, container: HTMLElement): RevivedQuoteSelector => {
    const { quote, start, end } = selector;
    if (start !== undefined && end !== undefined) {
      try {
        const revived = reviveTextSelector({ quote, start, end }, container);
        if (!revived.range.collapsed && revived.range.toString() === quote) {
          return { ...selector, range: revived.range, via: 'position', score: 1 };
        }
      } catch {
        // fall through to quote matching
      }
    }
    const text = annotatableText(container);
    const opts: MatchOptions = { minScore };
    if (selector.prefix !== undefined) opts.prefix = selector.prefix;
    if (selector.suffix !== undefined) opts.suffix = selector.suffix;
    if (start !== undefined) opts.hint = start;
    const match = matchQuote(text, quote, opts);
    if (!match) return { ...selector, range: document.createRange() };
    const revived = reviveTextSelector({ quote, start: match.start, end: match.end }, container);
    return { ...selector, range: revived.range, via: 'quote', score: match.score };
  };
}

function runThrough<A extends TextAnnotationLike, E>(
  anno: TextAnnotator<A, E>,
  root: HTMLElement,
  items: { id: string; selectors: Selector[] }[],
): AnchorResult[] {
  const silenced = console.error;
  // Recogito logs "Could not revive annotation target" for each orphan.
  console.error = () => {};
  try {
    anno.setAnnotations(items.map((i) => toW3C(i.id, i.selectors)) as never);
  } finally {
    console.error = silenced;
  }
  return items.map((item) => {
    const stored = anno.state.store.getAnnotation(item.id);
    const selector = stored?.target.selector[0] as RevivedQuoteSelector | undefined;
    if (!selector?.range || selector.range.collapsed) return { span: null };
    const result: AnchorResult = { span: rangeToSpan(root, selector.range) };
    if (selector.via) result.via = selector.via;
    if (selector.score !== undefined) result.score = selector.score;
    return result;
  });
}

export const recogitoDefault: Candidate = {
  id: 'recogito-default',
  description:
    'Recogito Text Annotator 4.3.7 with its bundled W3C adapter: revives by TextPosition offsets only.',
  anchorAll(root, items) {
    const anno = createTextAnnotator(root, {
      adapter: W3CTextFormat(location.href, root),
      annotatingEnabled: false,
    });
    try {
      return runThrough(anno, root, items);
    } finally {
      anno.destroy();
    }
  },
};

export function recogitoQuote(minScore: number, id: string, note: string): Candidate {
  return {
    id,
    sweep: minScore === 0,
    description: `Recogito Text Annotator 4.3.7 with our W3C adapter (keeps prefix and suffix) and a selectorReviveFn: position hit accepted only if its text equals the quote, else fuzzy quote matching${note}.`,
    anchorAll(root, items) {
      const anno = createTextAnnotator<QuoteAnnotation, W3CAnnotation>(root, {
        adapter: createW3CQuoteAdapter(),
        selectorReviveFn: quoteReviveFn(minScore),
        annotatingEnabled: false,
      });
      try {
        return runThrough(anno, root, items);
      } finally {
        anno.destroy();
      }
    },
  };
}
