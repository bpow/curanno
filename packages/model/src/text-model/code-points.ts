/**
 * Offsets in stored selectors count Unicode code points (ADR 0012); DOM
 * offsets and JavaScript string indices count UTF-16 code units. These
 * helpers convert between the two.
 */

/** Number of code points in `s`, or in `s` between UTF-16 indices. */
export function codePointLength(s: string, from = 0, to = s.length): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    // Count a high surrogate followed by a low surrogate once.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < to) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** UTF-16 index of the code point at code-point index `cp` in `s`. */
export function codePointToUtf16(s: string, cp: number): number {
  let i = 0;
  for (let n = 0; n < cp && i < s.length; n++) {
    const c = s.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < s.length ? 2 : 1;
  }
  return i;
}

/** Code-point index of the UTF-16 index `u16` in `s`. */
export function utf16ToCodePoint(s: string, u16: number): number {
  return codePointLength(s, 0, Math.min(u16, s.length));
}

/** Slice `s` by code-point indices. */
export function sliceCodePoints(s: string, start: number, end?: number): string {
  const a = codePointToUtf16(s, start);
  const b = end === undefined ? s.length : codePointToUtf16(s, end);
  return s.slice(a, b);
}
