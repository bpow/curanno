/**
 * Anchoring on the text model (ADR 0012, 0013, 0017). A scope is extracted
 * once per anchoring pass; `describe` turns a DOM range into selectors and
 * `anchor` turns stored selectors back into a code point range, which
 * `domRangeOf` resolves to a DOM Range for highlighting.
 */
export {
  MIN_FUZZY_QUOTE_LENGTH,
  MIN_QUOTE_SCORE,
  anchor,
  type AnchorOptions,
  type AnchorResult,
  type AnchorVia,
} from './anchor.js';
export { describe, describeTextRange } from './describe.js';
export { matchQuote, type MatchQuoteOptions, type ScoredMatch } from './match-quote.js';
export {
  createBrowserAdapter,
  createScope,
  domRangeOf,
  textPointsOf,
  textRangeOf,
  type AnchoringScope,
} from './scope.js';
export { nodeFromXPath, xpathFromNode } from './xpath.js';
export { DEFAULT_CONTEXT_LENGTH as CONTEXT_LENGTH } from '@scale/model';
