/**
 * Our own W3C format adapter for Recogito. Unlike the bundled `W3CTextFormat`
 * it keeps the TextQuoteSelector's prefix and suffix on the parsed selector so
 * a `selectorReviveFn` can use them, and it tolerates targets that carry only
 * a quote (no position) instead of rejecting the annotation.
 */
import type {
  FormatAdapter,
  ParseResult,
  TextAnnotationLike,
  TextSelectorLike,
} from '@recogito/text-annotator';
import type { Selector } from '../corpus.ts';

export type QuoteSelector = TextSelectorLike & {
  start?: number;
  end?: number;
  prefix?: string;
  suffix?: string;
};

export type QuoteAnnotation = Omit<TextAnnotationLike, 'target'> & {
  target: Omit<TextAnnotationLike['target'], 'selector'> & { selector: QuoteSelector[] };
};

export type W3CTarget = { source?: string; selector: Selector | Selector[] };
export type W3CAnnotation = {
  '@context'?: string;
  id: string;
  type: 'Annotation';
  body?: unknown;
  target: W3CTarget | W3CTarget[];
};

export function parseTarget(target: W3CTarget): QuoteSelector | null {
  const selectors = Array.isArray(target.selector) ? target.selector : [target.selector];
  const out: Partial<QuoteSelector> = {};
  for (const s of selectors) {
    if (s.type === 'TextQuoteSelector') {
      out.quote = s.exact;
      if (s.prefix !== undefined) out.prefix = s.prefix;
      if (s.suffix !== undefined) out.suffix = s.suffix;
    } else if (s.type === 'TextPositionSelector') {
      out.start = s.start;
      out.end = s.end;
    }
  }
  return out.quote === undefined ? null : (out as QuoteSelector);
}

export function createW3CQuoteAdapter(): FormatAdapter<QuoteAnnotation, W3CAnnotation> {
  return {
    parse: (a: W3CAnnotation): ParseResult<QuoteAnnotation> => {
      const targets = Array.isArray(a.target) ? a.target : [a.target];
      const selector = targets.map(parseTarget).filter((s): s is QuoteSelector => s !== null);
      if (selector.length === 0) {
        return { error: new Error(`no TextQuoteSelector in ${a.id}`) };
      }
      return {
        parsed: {
          id: a.id,
          bodies: [],
          target: { annotation: a.id, selector },
        },
      };
    },
    serialize: (a: QuoteAnnotation): W3CAnnotation => ({
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      id: a.id,
      type: 'Annotation',
      target: a.target.selector.map((s) => {
        const quote: Selector = { type: 'TextQuoteSelector', exact: s.quote };
        if (s.prefix !== undefined) quote.prefix = s.prefix;
        if (s.suffix !== undefined) quote.suffix = s.suffix;
        const selector: Selector[] = [quote];
        if (s.start !== undefined && s.end !== undefined) {
          selector.push({ type: 'TextPositionSelector', start: s.start, end: s.end });
        }
        return { selector };
      }),
    }),
  };
}
