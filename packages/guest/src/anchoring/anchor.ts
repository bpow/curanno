/**
 * Anchoring: from stored selectors to a range in the scope's text. The
 * selector order and the quote check on every strategy follow the Hypothesis
 * client's `anchoring/html.ts` (ADR 0017); the offsets and text come from
 * the text model (ADR 0012, 0013); failures are reported, never repaired
 * (ADR 0010).
 */
import {
  extractText,
  pointFromTextOffset,
  rangeFromPoints,
  resolvePosition,
  textOfRange,
  type OneOrMany,
  type RangeSelector,
  type Selector,
  type TextPoint,
  type TextPositionSelector,
  type TextQuoteSelector,
  type TextRange,
} from '@scale/model';
import { matchQuote, type ScoredMatch } from './match-quote.js';
import type { AnchoringScope } from './scope.js';
import { nodeFromXPath } from './xpath.js';

/**
 * A quote match scoring below this is an orphan. Tuned on the anchoring
 * corpus (ADR 0017): 0.75 removed every false anchor there at the cost of
 * one re-anchor; the corpus gates changes.
 */
export const MIN_QUOTE_SCORE = 0.75;

/**
 * Quotes shorter than this many code points are never matched
 * approximately: with few characters, "a few edits" and "a different
 * quote" are indistinguishable.
 */
export const MIN_FUZZY_QUOTE_LENGTH = 8;

export type AnchorVia = 'range' | 'position' | 'quote';

export type AnchorResult =
  | { state: 'anchored'; range: TextRange; via: AnchorVia; score: number }
  | { state: 'ambiguous'; candidates: TextRange[]; score: number }
  | { state: 'orphaned'; reason: string };

export interface AnchorOptions {
  minScore?: number;
  minFuzzyQuoteLength?: number;
}

/**
 * Anchor one target's selectors against a scope. Tries the RangeSelector,
 * then the TextPositionSelector, each accepted only when the text it now
 * covers equals the stored quote, then quote matching. Selectors of other
 * types are ignored here (PDF page fragments are Phase 5).
 */
export function anchor(
  scope: AnchoringScope,
  selectors: OneOrMany<Selector>,
  options: AnchorOptions = {},
): AnchorResult {
  let quote: TextQuoteSelector | undefined;
  let position: TextPositionSelector | undefined;
  let range: RangeSelector | undefined;
  for (const selector of Array.isArray(selectors) ? selectors : [selectors]) {
    if (selector.type === 'TextQuoteSelector') quote = selector;
    else if (selector.type === 'TextPositionSelector') position = selector;
    else if (selector.type === 'RangeSelector') range = selector;
  }
  if (!quote && !position && !range) return { state: 'orphaned', reason: 'no text selector' };

  const expected = quote?.exact.normalize('NFC');
  const matchesQuote = (candidate: TextRange): boolean =>
    expected === undefined || textOfRange(scope.map.text, candidate) === expected;

  if (range) {
    const found = fromRangeSelector(scope, range);
    if (found && matchesQuote(found))
      return { state: 'anchored', range: found, via: 'range', score: 1 };
  }
  if (position) {
    const text = resolvePosition(scope.map.text, position);
    if (text !== undefined && (expected === undefined || text === expected)) {
      return {
        state: 'anchored',
        range: { start: position.start, end: position.end },
        via: 'position',
        score: 1,
      };
    }
  }
  if (!quote) return { state: 'orphaned', reason: 'stored range and position no longer match' };

  const minScore = options.minScore ?? MIN_QUOTE_SCORE;
  const matches = matchQuote(scope.map, quote, {
    minFuzzyQuoteLength: options.minFuzzyQuoteLength ?? MIN_FUZZY_QUOTE_LENGTH,
    ...(position ? { hint: position.start } : {}),
  });
  const best = matches[0];
  if (!best) return { state: 'orphaned', reason: 'quote not found' };
  if (best.score < minScore) {
    return {
      state: 'orphaned',
      reason: `best quote match scored ${best.score.toFixed(2)}, below ${minScore}`,
    };
  }
  const tied = matches.filter((m) => m === best || (scoresEqual(m, best) && !overlaps(m, best)));
  if (tied.length > 1) {
    return {
      state: 'ambiguous',
      candidates: tied.map((m) => ({ start: m.start, end: m.end })),
      score: best.score,
    };
  }
  return {
    state: 'anchored',
    range: { start: best.start, end: best.end },
    via: 'quote',
    score: best.score,
  };
}

function scoresEqual(a: ScoredMatch, b: ScoredMatch): boolean {
  return Math.abs(a.score - b.score) < 1e-9;
}

function overlaps(a: TextRange, b: TextRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Resolve a RangeSelector whose start and end are XPathSelectors refined by
 * TextPositionSelectors. The XPaths are relative to the scope root; each
 * refining offset counts code points of the named element's own text
 * (text model, section 4). Per the W3C model the range runs from the start
 * of the start selector to the start of the end selector.
 */
function fromRangeSelector(scope: AnchoringScope, selector: RangeSelector): TextRange | undefined {
  const start = pointFromSelector(scope, selector.startSelector, 'start');
  const end = pointFromSelector(scope, selector.endSelector, 'end');
  if (!start || !end) return undefined;
  return rangeFromPoints(scope.map, start, end);
}

function pointFromSelector(
  scope: AnchoringScope,
  selector: Selector,
  bias: 'start' | 'end',
): TextPoint<Node> | undefined {
  if (selector.type !== 'XPathSelector') return undefined;
  const element = nodeFromXPath(selector.value, scope.root);
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
  const refinements = selector.refinedBy
    ? Array.isArray(selector.refinedBy)
      ? selector.refinedBy
      : [selector.refinedBy]
    : [];
  const refined = refinements.find((r) => r.type === 'TextPositionSelector');
  const offset = refined?.type === 'TextPositionSelector' ? refined.start : 0;
  const map = element === scope.root ? scope.map : extractText(element, scope.map.adapter);
  return pointFromTextOffset(map, offset, bias);
}
