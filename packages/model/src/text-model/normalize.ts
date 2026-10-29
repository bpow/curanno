import type { TextPoint, TextTreeAdapter } from './adapter.js';
import { codePointLength, codePointToUtf16 } from './code-points.js';

/**
 * Builds the normalized text of a tree and the map between that text and
 * the tree's text nodes. The rules are specified in docs/text-model.md;
 * this file is their reference implementation.
 */

/** Elements whose content never contributes text, whatever their style. */
export const EXCLUDED_ELEMENTS: ReadonlySet<string> = new Set([
  'head',
  'script',
  'style',
  'template',
  'noscript',
]);

/** Elements whose content is preformatted by the user-agent stylesheet. */
export const PREFORMATTED_ELEMENTS: ReadonlySet<string> = new Set([
  'pre',
  'textarea',
  'listing',
  'plaintext',
  'xmp',
]);

/** Attribute that marks an element, and everything inside it, as not annotatable. */
export const NOT_ANNOTATABLE_ATTRIBUTE = 'data-annotatable';

export type WhiteSpaceMode = 'normal' | 'pre' | 'pre-line';

export type SegmentKind =
  /** Source characters copied one for one. */
  | 'text'
  /** Source characters whose NFC form has a different length. */
  | 'nfc'
  /** A collapsible whitespace run (or its first part) that became one space. */
  | 'space'
  /** A collapsible whitespace run (or a later part of one) that produced nothing. */
  | 'dropped'
  /** A `<br>` element, which became a line feed. */
  | 'break';

export interface TextSegment<N> {
  kind: SegmentKind;
  /** The text node, or the `<br>` element for a break. */
  node: N;
  /** UTF-16 offsets into the node's data. Both 0 for a break. */
  nodeStart: number;
  nodeEnd: number;
  /** Code point offsets into the normalized text. */
  textStart: number;
  textEnd: number;
}

export interface TextMap<N> {
  /** The normalized text of the scope. */
  text: string;
  /** Segments in document order. Every character of `text` belongs to exactly one. */
  segments: TextSegment<N>[];
  /** Segments by text node, in node order, for point lookups. */
  byNode: Map<N, TextSegment<N>[]>;
  /** Code point indices of characters outside the BMP, ascending. */
  astralCodePoints: number[];
  /** UTF-16 indices of the same characters, ascending. */
  astralUtf16: number[];
  adapter: TextTreeAdapter<N>;
}

const COLLAPSIBLE = /[ \t\n\r\f]/;
const MARK = /\p{M}/u;

class Builder<N> {
  readonly segments: TextSegment<N>[] = [];
  readonly astralCodePoints: number[] = [];
  readonly astralUtf16: number[] = [];
  private readonly parts: string[] = [];
  private length = 0; // code points
  private utf16Length = 0;
  private pending: TextSegment<N>[] = [];
  private lastWasBreak = true; // the start of the text behaves like a line start

  constructor(private readonly adapter: TextTreeAdapter<N>) {}

  visit(node: N, inherited: WhiteSpaceMode): void {
    const kind = this.adapter.kind(node);
    if (kind === 'text') {
      this.visitText(node, inherited);
      return;
    }
    if (kind !== 'element') return;
    if (isExcluded(node, this.adapter)) return;
    const tag = this.adapter.tagName(node);
    if (tag === 'br') {
      this.flushPending(true);
      this.append('\n');
      this.segments.push({
        kind: 'break',
        node,
        nodeStart: 0,
        nodeEnd: 0,
        textStart: this.length - 1,
        textEnd: this.length,
      });
      this.lastWasBreak = true;
      return;
    }
    const mode = whiteSpaceMode(node, this.adapter) ?? inherited;
    for (const child of this.adapter.children(node)) this.visit(child, mode);
  }

  finish(text: string): TextMap<N> {
    this.flushPending(true);
    const byNode = new Map<N, TextSegment<N>[]>();
    for (const seg of this.segments) {
      if (seg.kind === 'break') continue;
      const list = byNode.get(seg.node);
      if (list) list.push(seg);
      else byNode.set(seg.node, [seg]);
    }
    return {
      text,
      segments: this.segments,
      byNode,
      astralCodePoints: this.astralCodePoints,
      astralUtf16: this.astralUtf16,
      adapter: this.adapter,
    };
  }

  get text(): string {
    return this.parts.join('');
  }

  private visitText(node: N, mode: WhiteSpaceMode): void {
    const data = this.adapter.textData(node);
    let i = 0;
    while (i < data.length) {
      const ch = data.charAt(i);
      if (mode !== 'normal' && ch === '\n') {
        this.flushPending(true);
        this.pushCopy(node, i, i + 1, '\n');
        this.lastWasBreak = true;
        i++;
      } else if (mode !== 'pre' && COLLAPSIBLE.test(ch)) {
        let j = i + 1;
        while (j < data.length && COLLAPSIBLE.test(data.charAt(j))) {
          if (mode === 'pre-line' && data.charAt(j) === '\n') break;
          j++;
        }
        this.pending.push({
          kind: 'dropped',
          node,
          nodeStart: i,
          nodeEnd: j,
          textStart: 0,
          textEnd: 0,
        });
        i = j;
      } else {
        let j = i + 1;
        while (j < data.length) {
          const c = data.charAt(j);
          if (mode !== 'normal' && c === '\n') break;
          if (mode !== 'pre' && COLLAPSIBLE.test(c)) break;
          j++;
        }
        this.flushPending(false);
        this.pushChunk(node, i, j, data.slice(i, j));
        this.lastWasBreak = false;
        i = j;
      }
    }
  }

  /** Emit a chunk of non-collapsible characters, splitting where NFC changes it. */
  private pushChunk(node: N, start: number, end: number, chunk: string): void {
    const nfc = chunk.normalize('NFC');
    if (nfc === chunk) {
      this.pushCopy(node, start, end, chunk);
      return;
    }
    // Split before every code point that can begin a composition (a base
    // character, or a leading Hangul jamo), so that each run is one base with
    // its combining marks or one Hangul syllable. If the runs' NFC forms do
    // not add up to the whole chunk's NFC form, treat the chunk as one run.
    let runs: { start: number; end: number }[] = [];
    let runStart = 0;
    for (let i = 0; i < chunk.length;) {
      const cp = chunk.codePointAt(i) as number;
      const width = cp > 0xffff ? 2 : 1;
      if (i > 0 && startsRun(cp)) {
        runs.push({ start: runStart, end: i });
        runStart = i;
      }
      i += width;
    }
    runs.push({ start: runStart, end: chunk.length });
    const joined = runs.map((r) => chunk.slice(r.start, r.end).normalize('NFC')).join('');
    if (joined !== nfc) runs = [{ start: 0, end: chunk.length }];
    for (const r of runs) {
      const src = chunk.slice(r.start, r.end);
      const out = src.normalize('NFC');
      if (out === src) {
        this.pushCopy(node, start + r.start, start + r.end, src);
      } else {
        const textStart = this.length;
        this.append(out);
        this.segments.push({
          kind: 'nfc',
          node,
          nodeStart: start + r.start,
          nodeEnd: start + r.end,
          textStart,
          textEnd: this.length,
        });
      }
    }
  }

  private pushCopy(node: N, start: number, end: number, chunk: string): void {
    const textStart = this.length;
    this.append(chunk);
    this.segments.push({
      kind: 'text',
      node,
      nodeStart: start,
      nodeEnd: end,
      textStart,
      textEnd: this.length,
    });
  }

  private append(s: string): void {
    this.parts.push(s);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        this.astralCodePoints.push(this.length);
        this.astralUtf16.push(this.utf16Length + i);
        i++;
      }
      this.length++;
    }
    this.utf16Length += s.length;
  }

  /**
   * Resolve collapsible whitespace gathered so far. A run at the start of the
   * text, at its end, or next to a line feed produces nothing; any other run
   * produces one space.
   */
  private flushPending(atBreakOrEnd: boolean): void {
    if (this.pending.length === 0) return;
    const drop = atBreakOrEnd || this.lastWasBreak;
    const first = this.pending[0] as TextSegment<N>;
    if (drop) {
      for (const seg of this.pending) {
        seg.textStart = seg.textEnd = this.length;
        this.segments.push(seg);
      }
    } else {
      first.kind = 'space';
      first.textStart = this.length;
      this.append(' ');
      first.textEnd = this.length;
      this.segments.push(first);
      for (const seg of this.pending.slice(1)) {
        seg.textStart = seg.textEnd = this.length;
        this.segments.push(seg);
      }
    }
    this.pending = [];
  }
}

/** Whether a code point begins a new normalization run (see pushChunk). */
function startsRun(cp: number): boolean {
  // Hangul vowel and trailing jamo attach to the preceding leading jamo.
  if ((cp >= 0x1160 && cp <= 0x11ff) || (cp >= 0xd7b0 && cp <= 0xd7ff)) return false;
  return !MARK.test(String.fromCodePoint(cp));
}

function isExcluded<N>(node: N, adapter: TextTreeAdapter<N>): boolean {
  if (EXCLUDED_ELEMENTS.has(adapter.tagName(node))) return true;
  if (adapter.attribute(node, 'hidden') !== null) return true;
  if (adapter.attribute(node, 'aria-hidden') === 'true') return true;
  if (adapter.attribute(node, NOT_ANNOTATABLE_ATTRIBUTE) === 'false') return true;
  const display = adapter.display?.(node) ?? inlineStyle(node, adapter, 'display');
  return display === 'none';
}

function whiteSpaceMode<N>(node: N, adapter: TextTreeAdapter<N>): WhiteSpaceMode | null {
  const value = adapter.whiteSpace?.(node) ?? inlineStyle(node, adapter, 'white-space');
  switch (value) {
    case 'pre':
    case 'pre-wrap':
    case 'break-spaces':
      return 'pre';
    case 'pre-line':
      return 'pre-line';
    case 'normal':
    case 'nowrap':
      return 'normal';
    default:
      return PREFORMATTED_ELEMENTS.has(adapter.tagName(node)) ? 'pre' : null;
  }
}

/** Reads one property from an inline `style` attribute; last declaration wins. */
export function inlineStyle<N>(
  node: N,
  adapter: TextTreeAdapter<N>,
  property: string,
): string | null {
  const style = adapter.attribute(node, 'style');
  if (!style) return null;
  let found: string | null = null;
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    if (declaration.slice(0, colon).trim().toLowerCase() !== property) continue;
    found = declaration
      .slice(colon + 1)
      .replace(/!important$/i, '')
      .trim()
      .toLowerCase();
  }
  return found;
}

/** Normalize the text under `root` and build its map. */
export function extractText<N>(root: N, adapter: TextTreeAdapter<N>): TextMap<N> {
  const builder = new Builder(adapter);
  builder.visit(root, 'normal');
  return builder.finish(builder.text);
}

/** Convert a code point offset in `map.text` to a UTF-16 index. */
export function textUtf16Index<N>(map: TextMap<N>, codePoint: number): number {
  return codePoint + countBelow(map.astralCodePoints, codePoint);
}

/** Convert a UTF-16 index in `map.text` to a code point offset. */
export function textCodePointIndex<N>(map: TextMap<N>, utf16: number): number {
  return utf16 - countBelow(map.astralUtf16, utf16);
}

function countBelow(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Code point offset of a boundary point. Returns undefined when the point's
 * node contributes no text (hidden, excluded, or not under the scope root).
 * `bias` says which side of a collapsed or recomposed run an interior point
 * belongs to; use 'start' for a range's start and 'end' for its end.
 */
export function textOffsetFromPoint<N>(
  map: TextMap<N>,
  point: TextPoint<N>,
  bias: 'start' | 'end' = 'start',
): number | undefined {
  const list = map.byNode.get(point.node);
  if (!list) return undefined;
  let seg: TextSegment<N> | undefined;
  for (const s of list) {
    if (point.offset >= s.nodeStart && point.offset <= s.nodeEnd) {
      seg = s;
      if (point.offset < s.nodeEnd) break;
    }
  }
  if (!seg) return undefined;
  switch (seg.kind) {
    case 'text': {
      const data = map.adapter.textData(seg.node);
      return seg.textStart + codePointLength(data, seg.nodeStart, point.offset);
    }
    case 'nfc':
      if (point.offset === seg.nodeStart) return seg.textStart;
      if (point.offset === seg.nodeEnd) return seg.textEnd;
      return bias === 'start' ? seg.textStart : seg.textEnd;
    case 'space':
      return point.offset === seg.nodeStart ? seg.textStart : seg.textEnd;
    default:
      return seg.textStart;
  }
}

/**
 * Boundary point for a code point offset. With bias 'start' the point is
 * placed at the beginning of the text that follows the offset; with 'end' at
 * the end of the text that precedes it. Line feeds from `<br>` have no text
 * node, so an offset next to one resolves to the neighbouring text.
 */
export function pointFromTextOffset<N>(
  map: TextMap<N>,
  offset: number,
  bias: 'start' | 'end' = 'start',
): TextPoint<N> | undefined {
  const segs = map.segments;
  let index: number;
  if (bias === 'start') {
    index = segs.findIndex((s) => s.textStart <= offset && offset < s.textEnd);
    if (index < 0)
      index = findLastIndex(segs, (s) => s.textEnd === offset && s.textStart < s.textEnd);
  } else {
    index = findLastIndex(segs, (s) => s.textStart < offset && offset <= s.textEnd);
    if (index < 0) index = segs.findIndex((s) => s.textStart === offset && s.textStart < s.textEnd);
  }
  if (index < 0) return undefined;
  const seg = segs[index] as TextSegment<N>;
  if (seg.kind === 'break') {
    const before = neighbour(segs, index, -1);
    const after = neighbour(segs, index, +1);
    const target = bias === 'start' ? (before ?? after) : (after ?? before);
    if (!target || target.kind === 'break') return undefined;
    return { node: target.node, offset: target === before ? target.nodeEnd : target.nodeStart };
  }
  if (seg.kind === 'text') {
    const data = map.adapter.textData(seg.node);
    const within = data.slice(seg.nodeStart, seg.nodeEnd);
    return {
      node: seg.node,
      offset: seg.nodeStart + codePointToUtf16(within, offset - seg.textStart),
    };
  }
  return { node: seg.node, offset: offset === seg.textStart ? seg.nodeStart : seg.nodeEnd };
}

function neighbour<N>(
  segs: TextSegment<N>[],
  from: number,
  step: -1 | 1,
): TextSegment<N> | undefined {
  for (let i = from + step; i >= 0 && i < segs.length; i += step) {
    const s = segs[i] as TextSegment<N>;
    if (s.textStart < s.textEnd) return s;
  }
  return undefined;
}

function findLastIndex<T>(list: T[], pred: (t: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i] as T)) return i;
  return -1;
}
