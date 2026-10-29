/**
 * Text model: the rules by which an HTML tree becomes the normalized text
 * that TextQuoteSelector and TextPositionSelector refer to, and the mapping
 * back from offsets in that text to tree positions. Specified in
 * docs/text-model.md and fixed by the fixture suite in fixtures/text-model/.
 */
export const TEXT_MODEL_VERSION = '0.1.0';

export type { NodeKind, TextPoint, TextTreeAdapter } from './adapter.js';
export {
  codePointLength,
  codePointToUtf16,
  sliceCodePoints,
  utf16ToCodePoint,
} from './code-points.js';
export {
  EXCLUDED_ELEMENTS,
  NOT_ANNOTATABLE_ATTRIBUTE,
  PREFORMATTED_ELEMENTS,
  extractText,
  inlineStyle,
  pointFromTextOffset,
  textCodePointIndex,
  textOffsetFromPoint,
  textUtf16Index,
  type SegmentKind,
  type TextMap,
  type TextSegment,
  type WhiteSpaceMode,
} from './normalize.js';
export {
  DEFAULT_CONTEXT_LENGTH,
  describeRange,
  findQuote,
  rangeFromPoints,
  resolvePosition,
  textOfRange,
  utf16RangeOf,
  type DescribeOptions,
  type QuoteMatch,
  type TextRange,
  type TextSelectors,
} from './selectors.js';
export { createDomAdapter, type DomAdapterOptions, type DomLikeNode } from './dom-adapter.js';
