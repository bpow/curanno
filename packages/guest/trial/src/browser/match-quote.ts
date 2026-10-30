/**
 * Fuzzy quote matching for the Recogito-plus-quote candidate, in the style of
 * the Hypothesis client's `match-quote.ts`: find approximate matches of the
 * quote with `approx-string-match`, then rank them by how well the text
 * around each one matches the stored prefix and suffix, with the stored
 * position as a tie-breaker. Written fresh so the candidate can tune the
 * policy (notably `minScore`) independently of the vendored code.
 */
import approxSearch from 'approx-string-match';

export type QuoteMatch = { start: number; end: number; score: number };

export type MatchOptions = {
  prefix?: string;
  suffix?: string;
  /** Expected start offset. */
  hint?: number;
  /** Matches scoring below this are rejected. 0 reproduces Hypothesis's behaviour. */
  minScore?: number;
};

type RawMatch = { start: number; end: number; errors: number };

function search(text: string, pattern: string, maxErrors: number): RawMatch[] {
  const exact: RawMatch[] = [];
  let at = text.indexOf(pattern);
  while (at !== -1) {
    exact.push({ start: at, end: at + pattern.length, errors: 0 });
    at = text.indexOf(pattern, at + 1);
  }
  if (exact.length > 0) return exact;
  return approxSearch(text, pattern, maxErrors);
}

function similarity(text: string, pattern: string): number {
  if (!text || !pattern) return 0;
  const [best] = search(text, pattern, pattern.length);
  return best ? 1 - best.errors / pattern.length : 0;
}

export function matchQuote(
  text: string,
  quote: string,
  opts: MatchOptions = {},
): QuoteMatch | null {
  if (!quote) return null;
  const maxErrors = Math.min(256, Math.floor(quote.length / 2));
  const matches = search(text, quote, maxErrors);
  if (matches.length === 0) return null;

  const scored = matches.map((m) => {
    const quoteScore = 1 - m.errors / quote.length;
    const prefixScore = opts.prefix
      ? similarity(text.slice(Math.max(0, m.start - opts.prefix.length), m.start), opts.prefix)
      : 1;
    const suffixScore = opts.suffix
      ? similarity(text.slice(m.end, m.end + opts.suffix.length), opts.suffix)
      : 1;
    const posScore =
      typeof opts.hint === 'number' ? 1 - Math.abs(m.start - opts.hint) / text.length : 1;
    const score = (50 * quoteScore + 20 * prefixScore + 20 * suffixScore + 2 * posScore) / 92;
    return { start: m.start, end: m.end, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best.score >= (opts.minScore ?? 0) ? best : null;
}
