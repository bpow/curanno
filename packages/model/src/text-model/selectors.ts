import type { TextPositionSelector, TextQuoteSelector } from '../annotation/types.js';
import type { TextPoint } from './adapter.js';
import { codePointLength, sliceCodePoints } from './code-points.js';
import {
  textCodePointIndex,
  textOffsetFromPoint,
  textUtf16Index,
  type TextMap,
} from './normalize.js';

/** Code points of context recorded on each side of a quote. */
export const DEFAULT_CONTEXT_LENGTH = 32;

/** A half-open range of code point offsets in a scope's normalized text. */
export interface TextRange {
  start: number;
  end: number;
}

export interface DescribeOptions {
  contextLength?: number;
}

/** The two selectors this platform records for a text range. */
export interface TextSelectors {
  quote: TextQuoteSelector;
  position: TextPositionSelector;
}

/**
 * Convert two boundary points to a text range. Returns undefined when either
 * point lies in content that contributes no text, or when the result would
 * be empty or inverted.
 */
export function rangeFromPoints<N>(
  map: TextMap<N>,
  start: TextPoint<N>,
  end: TextPoint<N>,
): TextRange | undefined {
  const s = textOffsetFromPoint(map, start, 'start');
  const e = textOffsetFromPoint(map, end, 'end');
  if (s === undefined || e === undefined || e <= s) return undefined;
  return { start: s, end: e };
}

/** The normalized text covered by a range. */
export function textOfRange(text: string, range: TextRange): string {
  return sliceCodePoints(text, range.start, range.end);
}

/** Describe a range as a TextQuoteSelector and a TextPositionSelector. */
export function describeRange(
  text: string,
  range: TextRange,
  options: DescribeOptions = {},
): TextSelectors {
  const context = options.contextLength ?? DEFAULT_CONTEXT_LENGTH;
  const exact = sliceCodePoints(text, range.start, range.end);
  const prefix = sliceCodePoints(text, Math.max(0, range.start - context), range.start);
  const suffix = sliceCodePoints(text, range.end, range.end + context);
  const quote: TextQuoteSelector = { type: 'TextQuoteSelector', exact };
  if (prefix) quote.prefix = prefix;
  if (suffix) quote.suffix = suffix;
  return {
    quote,
    position: { type: 'TextPositionSelector', start: range.start, end: range.end },
  };
}

/**
 * The text a TextPositionSelector covers, or undefined when the selector
 * lies outside the text. Callers compare this with the stored quote before
 * trusting the position (ADR 0010).
 */
export function resolvePosition(text: string, selector: TextPositionSelector): string | undefined {
  const length = codePointLength(text);
  if (selector.start < 0 || selector.end > length || selector.end < selector.start)
    return undefined;
  return sliceCodePoints(text, selector.start, selector.end);
}

export interface QuoteMatch extends TextRange {
  /** Code points of the stored prefix that match the text before the candidate. */
  prefixMatch: number;
  /** Code points of the stored suffix that match the text after the candidate. */
  suffixMatch: number;
  /** True when the whole stored prefix and suffix match. */
  exactContext: boolean;
}

/**
 * Every occurrence of a TextQuoteSelector's `exact` text, best match first.
 * Matching is exact after NFC normalization; candidates are ordered by how
 * much of the stored prefix and suffix they agree with, then by distance from
 * `near` (typically the stored TextPositionSelector start) when given.
 *
 * Fuzzy matching for changed documents is a client concern and is not part
 * of the text model.
 */
export function findQuote(
  map: TextMap<unknown>,
  selector: TextQuoteSelector,
  near?: number,
): QuoteMatch[] {
  const text = map.text;
  const exact = selector.exact.normalize('NFC');
  if (exact.length === 0) return [];
  const prefix = (selector.prefix ?? '').normalize('NFC');
  const suffix = (selector.suffix ?? '').normalize('NFC');
  const matches: QuoteMatch[] = [];
  for (let at = text.indexOf(exact); at >= 0; at = text.indexOf(exact, at + 1)) {
    const start = textCodePointIndex(map, at);
    const end = textCodePointIndex(map, at + exact.length);
    const prefixMatch = commonSuffixLength(text.slice(0, at), prefix);
    const suffixMatch = commonPrefixLength(text.slice(at + exact.length), suffix);
    matches.push({
      start,
      end,
      prefixMatch,
      suffixMatch,
      exactContext:
        prefixMatch === codePointLength(prefix) && suffixMatch === codePointLength(suffix),
    });
  }
  matches.sort((a, b) => {
    const score = b.prefixMatch + b.suffixMatch - (a.prefixMatch + a.suffixMatch);
    if (score !== 0) return score;
    if (near !== undefined) return Math.abs(a.start - near) - Math.abs(b.start - near);
    return a.start - b.start;
  });
  return matches;
}

/** Convenience: the UTF-16 slice of `map.text` for a range. */
export function utf16RangeOf(map: TextMap<unknown>, range: TextRange): [number, number] {
  return [textUtf16Index(map, range.start), textUtf16Index(map, range.end)];
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return codePointLength(a, 0, i);
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  )
    i++;
  return codePointLength(a, a.length - i, a.length);
}
