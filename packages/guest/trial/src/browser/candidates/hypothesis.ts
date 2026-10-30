/**
 * The Hypothesis client's anchoring code (vendored under `vendor/hypothesis`),
 * fed W3C selectors. The client's own RangeSelector is a different shape from
 * the W3C one, so the XPath-plus-offset selectors the corpus stores are
 * converted first.
 */
import { anchor } from '../../../../vendor/hypothesis/anchoring/html.ts';
import type { Selector as HypothesisSelector } from '../../../../vendor/hypothesis/types/api.ts';
import type { Selector } from '../../corpus.ts';
import { flattenSelectors } from '../selectors.ts';
import { rangeToSpan } from '../text.ts';
import type { AnchorResult, Candidate } from './types.ts';

export function toHypothesisSelectors(selectors: Selector[]): HypothesisSelector[] {
  return flattenSelectors(selectors).map((s): HypothesisSelector => {
    if (s.type === 'FragmentSelector') throw new Error('page fragments are flattened first');
    if (s.type !== 'RangeSelector') return s;
    return {
      type: 'RangeSelector',
      startContainer: s.startSelector.value,
      startOffset: s.startSelector.refinedBy?.start ?? 0,
      endContainer: s.endSelector.value,
      endOffset: s.endSelector.refinedBy?.start ?? 0,
    };
  });
}

export const hypothesis: Candidate = {
  id: 'hypothesis',
  description:
    'Hypothesis client anchoring (vendored): RangeSelector, then TextPosition, each checked against the quote, then fuzzy quote matching.',
  async anchorAll(root, items) {
    const results: AnchorResult[] = [];
    for (const item of items) {
      try {
        const range = await anchor(root, toHypothesisSelectors(item.selectors));
        results.push({ span: rangeToSpan(root, range) });
      } catch (err) {
        results.push({ span: null, error: String(err) });
      }
    }
    return results;
  },
};
