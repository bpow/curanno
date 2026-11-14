/**
 * Finding a quote the model returned in the scope it read. A quote counts
 * only when it occurs verbatim, allowing for differences a model makes when
 * it copies text without changing it: whitespace, typographic quotes and
 * dashes, ellipses, soft hyphens and zero-width characters. Nothing fuzzier
 * is tried (ADR 0032): a quote the model reworded is not one we can vouch for.
 */
import type { ScopeView } from './view.js';
import { toSource } from './view.js';

export type Located =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: 'too-short' | 'not-found' | 'ambiguous' };

/** Quotes shorter than this, in UTF-16 code units, are too likely to be ambiguous or wrong. */
export const MIN_QUOTE_LENGTH = 4;

const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '−': '-',
  '…': '...',
};
// Soft hyphen and zero-width characters.
const REMOVED = /\u00ad|\u200b|\u200c|\u200d|\u2060|\ufeff/;
const SPACE = /\s/;

interface Folded {
  text: string;
  /** For each folded character, the index of the character it came from. */
  from: number[];
  /** For each folded character, the index after the character it came from. */
  to: number[];
}

function fold(input: string): Folded {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i] as string;
    if (REMOVED.test(c)) {
      i++;
      continue;
    }
    if (SPACE.test(c)) {
      let j = i + 1;
      while (
        j < input.length &&
        (SPACE.test(input[j] as string) || REMOVED.test(input[j] as string))
      )
        j++;
      text += ' ';
      from.push(i);
      to.push(j);
      i = j;
      continue;
    }
    const out = FOLD[c] ?? c;
    for (const ch of out) {
      text += ch;
      from.push(i);
      to.push(i + 1);
    }
    i++;
  }
  return { text, from, to };
}

function occurrences(text: string, pattern: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) found.push(at);
  return found;
}

/** Pick the one occurrence, or the one inside the chunk the quote came from. */
function choose(
  ranges: { start: number; end: number }[],
  chunk: { start: number; end: number },
): { start: number; end: number } | 'ambiguous' | undefined {
  if (ranges.length <= 1) return ranges[0];
  const inside = ranges.filter((r) => r.start >= chunk.start && r.end <= chunk.end);
  return inside.length === 1 ? inside[0] : 'ambiguous';
}

/**
 * Where `quote` is in the scope, as UTF-16 indices into the normalized
 * (source) text, trimmed of whitespace at either end.
 */
export function locateQuote(
  view: ScopeView,
  quote: string,
  chunk: { start: number; end: number },
): Located {
  const exact = quote.normalize('NFC').trim();
  if (exact.length < MIN_QUOTE_LENGTH) return { ok: false, reason: 'too-short' };

  let ranges = occurrences(view.text, exact).map((at) => ({ start: at, end: at + exact.length }));
  if (ranges.length === 0) {
    const haystack = fold(view.text);
    const needle = fold(exact).text.trim();
    if (needle.length < MIN_QUOTE_LENGTH) return { ok: false, reason: 'too-short' };
    ranges = occurrences(haystack.text, needle).map((at) => ({
      start: haystack.from[at] as number,
      end: haystack.to[at + needle.length - 1] as number,
    }));
  }
  const chosen = choose(ranges, chunk);
  if (chosen === undefined) return { ok: false, reason: 'not-found' };
  if (chosen === 'ambiguous') return { ok: false, reason: 'ambiguous' };

  let start = toSource(view, chosen.start);
  let end = toSource(view, chosen.end);
  while (start < end && SPACE.test(view.source[start] as string)) start++;
  while (end > start && SPACE.test(view.source[end - 1] as string)) end--;
  if (end - start < MIN_QUOTE_LENGTH) return { ok: false, reason: 'too-short' };
  return { ok: true, start, end };
}
