/**
 * Quote matching over the text model's normalized text. Exact occurrences
 * come from the model's `findQuote`; when there are none, an approximate
 * search allows edits inside the quote. Every candidate is scored the way
 * the Hypothesis client's `match-quote.ts` scores it (BSD-2-Clause; see
 * ../../vendor/hypothesis/LICENSE and PROVENANCE.md): similarity of the
 * matched text to the quote, of the surrounding text to the stored prefix
 * and suffix, and closeness to the stored position as a tie-breaker.
 *
 * What is ours: offsets in and out are code points (ADR 0012), the search
 * runs over `TextMap.text`, and the caller applies a minimum score and a
 * minimum quote length for approximate matches (ADR 0017).
 */
import approxSearch, { type Match as RawMatch } from 'approx-string-match';
import {
  codePointLength,
  findQuote,
  textCodePointIndex,
  textUtf16Index,
  type TextMap,
  type TextQuoteSelector,
} from '@curanno/model';

export interface ScoredMatch {
  /** Code point offsets into the normalized text. */
  start: number;
  end: number;
  /** 1 for an exact match of quote and context; lower as either differs. */
  score: number;
  /** Edit distance between the matched text and the quote; 0 when exact. */
  errors: number;
}

export interface MatchQuoteOptions {
  /** Expected code point offset of the quote, from a TextPositionSelector. */
  hint?: number;
  /** Quotes shorter than this many code points are matched exactly only. */
  minFuzzyQuoteLength: number;
}

const QUOTE_WEIGHT = 50;
const PREFIX_WEIGHT = 20;
const SUFFIX_WEIGHT = 20;
const POSITION_WEIGHT = 2;
const MAX_SCORE = QUOTE_WEIGHT + PREFIX_WEIGHT + SUFFIX_WEIGHT + POSITION_WEIGHT;

/** Exact occurrences, then an approximate search. UTF-16 offsets. */
function search(text: string, pattern: string, maxErrors: number): RawMatch[] {
  const exact: RawMatch[] = [];
  for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) {
    exact.push({ start: at, end: at + pattern.length, errors: 0 });
  }
  if (exact.length > 0) return exact;
  return approxSearch(text, pattern, maxErrors);
}

/** Similarity in [0, 1] between `text` and `pattern`. */
function similarity(text: string, pattern: string): number {
  if (text.length === 0 || pattern.length === 0) return 0;
  const best = search(text, pattern, pattern.length)[0];
  return best ? 1 - best.errors / pattern.length : 0;
}

/**
 * Every candidate match for the quote, best first. Exact occurrences
 * (NFC) are always preferred; an approximate search runs only when there
 * is none and the quote is long enough for edits to be distinguishable
 * from a different quote.
 */
export function matchQuote(
  map: TextMap<unknown>,
  selector: TextQuoteSelector,
  options: MatchQuoteOptions,
): ScoredMatch[] {
  const text = map.text;
  const exact = selector.exact.normalize('NFC');
  if (exact.length === 0 || text.length === 0) return [];
  const prefix = selector.prefix?.normalize('NFC') ?? '';
  const suffix = selector.suffix?.normalize('NFC') ?? '';

  let raw: RawMatch[] = findQuote(map, selector).map((m) => ({
    start: textUtf16Index(map, m.start),
    end: textUtf16Index(map, m.end),
    errors: 0,
  }));
  if (raw.length === 0 && codePointLength(exact) >= options.minFuzzyQuoteLength) {
    raw = approxSearch(text, exact, Math.min(256, Math.floor(exact.length / 2)));
  }
  if (raw.length === 0) return [];

  const hint = options.hint === undefined ? undefined : textUtf16Index(map, options.hint);
  const scored = raw.map((m): ScoredMatch => {
    const quoteScore = 1 - m.errors / exact.length;
    const prefixScore = prefix
      ? similarity(text.slice(Math.max(0, m.start - prefix.length), m.start), prefix)
      : 1;
    const suffixScore = suffix ? similarity(text.slice(m.end, m.end + suffix.length), suffix) : 1;
    const positionScore = hint === undefined ? 1 : 1 - Math.abs(m.start - hint) / text.length;
    const score =
      (QUOTE_WEIGHT * quoteScore +
        PREFIX_WEIGHT * prefixScore +
        SUFFIX_WEIGHT * suffixScore +
        POSITION_WEIGHT * positionScore) /
      MAX_SCORE;
    return {
      start: textCodePointIndex(map, m.start),
      end: textCodePointIndex(map, m.end),
      score,
      errors: m.errors,
    };
  });
  scored.sort((a, b) => b.score - a.score || a.start - b.start);
  return scored;
}
