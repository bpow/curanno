/**
 * Two ways of drawing a highlight for the rendering comparison: wrapping
 * the text in elements (Hypothesis style) and the CSS Custom Highlight API.
 * Exposed as `window.__trialHl` and driven by `trial/src/highlights.ts`.
 */
import { spanToRange, type Span } from './text.ts';

export type Technique = 'wrap' | 'css-highlight';

const FILL = '#ffe600';
const HIGHLIGHT_NAME = 'trial';

let marks: Element[] = [];
let ranges: Range[] = [];
let styleEl: HTMLStyleElement | undefined;

function ensureStyle() {
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.textContent = `
    mark[data-trial] { background: ${FILL}; color: inherit; }
    ::highlight(${HIGHLIGHT_NAME}) { background-color: ${FILL}; }
  `;
  document.head.appendChild(styleEl);
}

function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  const out: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, (n) =>
    range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  );
  let n = walker.nextNode();
  while (n) {
    out.push(n as Text);
    n = walker.nextNode();
  }
  return out;
}

/** Wrap the text of `range` in <mark> elements, splitting text nodes at the ends. */
function wrap(range: Range): Element[] {
  const created: Element[] = [];
  const nodes = textNodesIn(range);
  for (const node of nodes) {
    let target = node;
    if (node === range.endContainer && range.endOffset < node.data.length) {
      node.splitText(range.endOffset);
    }
    if (node === range.startContainer && range.startOffset > 0) {
      target = node.splitText(range.startOffset);
    }
    if (!target.data.trim()) continue;
    const mark = document.createElement('mark');
    mark.dataset['trial'] = '';
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
    created.push(mark);
  }
  return created;
}

function draw(technique: Technique, rootSelector: string | undefined, spans: Span[]): number {
  ensureStyle();
  const root = (rootSelector ? document.querySelector<HTMLElement>(rootSelector) : document.body)!;
  const before = document.getElementsByTagName('*').length;
  if (technique === 'wrap') {
    for (const s of spans) marks.push(...wrap(spanToRange(root, s)));
  } else {
    ranges = spans.map((s) => spanToRange(root, s));
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  }
  return document.getElementsByTagName('*').length - before;
}

/** Re-anchor by position and redraw, as a guest would after a page change. */
function redraw(technique: Technique, rootSelector: string | undefined, spans: Span[]): void {
  clear();
  draw(technique, rootSelector, spans);
}

function clear(): void {
  for (const m of marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }
  marks = [];
  CSS.highlights.delete(HIGHLIGHT_NAME);
  ranges = [];
}

/**
 * Viewport points at which a highlight for the span should be painted: a
 * grid over the span's first client rect, after scrolling the span into
 * view. Null when the span cannot be resolved. Some points land on glyphs,
 * so the caller treats any highlight-coloured point as painted.
 */
function probe(rootSelector: string | undefined, span: Span): { x: number; y: number }[] | null {
  const root = (rootSelector ? document.querySelector<HTMLElement>(rootSelector) : document.body)!;
  let range: Range;
  try {
    range = spanToRange(root, span);
  } catch {
    return null;
  }
  range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  const rect = Array.from(range.getClientRects()).find((r) => r.width > 2 && r.height > 2);
  if (!rect) return null;
  const points: { x: number; y: number }[] = [];
  for (const fy of [0.2, 0.5, 0.8]) {
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      points.push({ x: rect.left + rect.width * fx, y: rect.top + rect.height * fy });
    }
  }
  return points;
}

const api = { draw, redraw, clear, probe, FILL };

declare global {
  interface Window {
    __trialHl: typeof api;
  }
}

window.__trialHl = api;
