/**
 * The corpus text model: offsets are UTF-16 code units into the anchoring
 * root's `textContent`. These helpers map between that model and DOM ranges
 * without depending on any candidate.
 */
import type { RangeSelector, Selector, TextQuoteSelector } from '../corpus.ts';

export type Span = { start: number; end: number };

export const CONTEXT_LENGTH = 32;

export function rootText(root: Element): string {
  return root.textContent ?? '';
}

/** Offsets of `range` within `root`'s text content. */
export function rangeToSpan(root: Element, range: Range): Span {
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

/** A range covering the `start`th to `end`th characters of `root`'s text. */
export function spanToRange(root: Element, span: Span): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let startSet = false;
  let node = walker.nextNode() as Text | null;
  let last: Text | null = null;
  while (node) {
    const len = node.data.length;
    if (!startSet && pos + len > span.start) {
      range.setStart(node, span.start - pos);
      startSet = true;
    }
    if (startSet && pos + len >= span.end) {
      range.setEnd(node, span.end - pos);
      return range;
    }
    pos += len;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  if (!startSet && last && span.start === pos) {
    range.setStart(last, last.data.length);
    startSet = true;
  }
  if (!startSet) throw new RangeError('span start beyond text');
  if (last) range.setEnd(last, last.data.length);
  return range;
}

/** Find the `occurrence`th (1-based) occurrence of `needle` in `hay`. */
export function nthIndexOf(hay: string, needle: string, occurrence: number): number {
  let from = 0;
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = hay.indexOf(needle, from);
    if (idx === -1) return -1;
    from = idx + 1;
  }
  return idx;
}

/**
 * Locate the text an expectation describes. With several occurrences, the
 * one whose surroundings match `prefix`/`suffix` wins; without context the
 * expectation is ambiguous and `null` is returned so the corpus gets fixed.
 */
export function locate(
  text: string,
  expected: { exact: string; prefix?: string; suffix?: string },
): Span | null {
  const candidates: number[] = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(expected.exact, from);
    if (idx === -1) break;
    candidates.push(idx);
    from = idx + 1;
  }
  if (candidates.length === 0) return null;
  let matches = candidates;
  if (expected.prefix !== undefined) {
    const p = expected.prefix;
    matches = matches.filter((i) => text.slice(Math.max(0, i - p.length), i) === p);
  }
  if (expected.suffix !== undefined) {
    const s = expected.suffix;
    const len = expected.exact.length;
    matches = matches.filter((i) => text.slice(i + len, i + len + s.length) === s);
  }
  if (matches.length !== 1) return null;
  const start = matches[0];
  return { start, end: start + expected.exact.length };
}

/** Simple XPath of the form `/tag[n]/tag[n]` for `element`, relative to `root`. */
export function xpathFromElement(element: Element, root: Element): string {
  const segments: string[] = [];
  let el: Element | null = element;
  while (el && el !== root) {
    let pos = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.nodeName === el.nodeName) pos++;
      sib = sib.previousElementSibling;
    }
    segments.unshift(`${el.nodeName.toLowerCase()}[${pos}]`);
    el = el.parentElement;
  }
  if (el !== root) throw new Error('element is not inside root');
  return '/' + segments.join('/');
}

function elementOffset(node: Text, offset: number): { element: Element; offset: number } {
  const element = node.parentElement!;
  let before = 0;
  for (const child of Array.from(element.childNodes)) {
    if (child === node) break;
    before += child.textContent?.length ?? 0;
  }
  return { element, offset: before + offset };
}

/** Describe a text-node-bounded range as the three selector types the corpus stores. */
export function describeRange(root: Element, range: Range): Selector[] {
  const text = rootText(root);
  const span = rangeToSpan(root, range);
  const quote: TextQuoteSelector = {
    type: 'TextQuoteSelector',
    exact: text.slice(span.start, span.end),
    prefix: text.slice(Math.max(0, span.start - CONTEXT_LENGTH), span.start),
    suffix: text.slice(span.end, span.end + CONTEXT_LENGTH),
  };
  const s = elementOffset(range.startContainer as Text, range.startOffset);
  const e = elementOffset(range.endContainer as Text, range.endOffset);
  const rangeSelector: RangeSelector = {
    type: 'RangeSelector',
    startSelector: {
      type: 'XPathSelector',
      value: xpathFromElement(s.element, root),
      refinedBy: { type: 'TextPositionSelector', start: s.offset, end: s.offset },
    },
    endSelector: {
      type: 'XPathSelector',
      value: xpathFromElement(e.element, root),
      refinedBy: { type: 'TextPositionSelector', start: e.offset, end: e.offset },
    },
  };
  return [quote, { type: 'TextPositionSelector', start: span.start, end: span.end }, rangeSelector];
}
