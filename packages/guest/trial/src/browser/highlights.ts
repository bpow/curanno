/**
 * Three ways of drawing a highlight for the rendering comparison:
 * wrapping the text in elements (Hypothesis style), Recogito's overlay of
 * absolutely positioned spans, and the CSS Custom Highlight API. Exposed as
 * `window.__trialHl` and driven by `trial/src/highlights.ts`.
 */
import { createTextAnnotator, type TextAnnotator } from '@recogito/text-annotator';
import recogitoCss from '@recogito/text-annotator/text-annotator.css';
import { quoteReviveFn } from './candidates/recogito.ts';
import {
  createW3CQuoteAdapter,
  type QuoteAnnotation,
  type W3CAnnotation,
} from './recogito-w3c-adapter.ts';
import { spanToRange, type Span } from './text.ts';

export type Technique = 'wrap' | 'overlay' | 'css-highlight';

const FILL = '#ffe600';
const HIGHLIGHT_NAME = 'trial';

let recogito: TextAnnotator<QuoteAnnotation, W3CAnnotation> | undefined;
let marks: Element[] = [];
let ranges: Range[] = [];
let styleEl: HTMLStyleElement | undefined;

function ensureStyle() {
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.textContent = `${recogitoCss}
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

function overlayAnnotations(spans: Span[], root: HTMLElement): W3CAnnotation[] {
  return spans.map((s, i) => {
    const range = spanToRange(root, s);
    return {
      id: `hl-${i}`,
      type: 'Annotation',
      target: {
        selector: [
          { type: 'TextQuoteSelector', exact: range.toString() },
          { type: 'TextPositionSelector', start: s.start, end: s.end },
        ],
      },
    };
  });
}

function draw(technique: Technique, rootSelector: string | undefined, spans: Span[]): number {
  ensureStyle();
  const root = (rootSelector ? document.querySelector<HTMLElement>(rootSelector) : document.body)!;
  const before = document.getElementsByTagName('*').length;
  if (technique === 'wrap') {
    for (const s of spans) marks.push(...wrap(spanToRange(root, s)));
  } else if (technique === 'overlay') {
    recogito = createTextAnnotator<QuoteAnnotation, W3CAnnotation>(root, {
      adapter: createW3CQuoteAdapter(),
      selectorReviveFn: quoteReviveFn(0),
      annotatingEnabled: false,
      renderer: 'SPANS',
      style: { fill: FILL, fillOpacity: 1 },
    });
    recogito.setAnnotations(overlayAnnotations(spans, root));
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
  recogito?.destroy();
  recogito = undefined;
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

/** For the overlay: distance between each drawn highlight and its text, after scrolling. */
function overlayOffsets(rootSelector: string | undefined, spans: Span[]): (number | null)[] {
  const root = (rootSelector ? document.querySelector<HTMLElement>(rootSelector) : document.body)!;
  const layer = root.querySelector('.r6o-span-highlight-layer');
  if (!layer) return spans.map(() => null);
  return spans.map((s) => {
    const textRect = spanToRange(root, s).getClientRects()[0];
    if (!textRect) return null;
    let best = Infinity;
    for (const el of Array.from(layer.children)) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left - textRect.left, r.top - textRect.top);
      if (d < best) best = d;
    }
    return Number.isFinite(best) ? Math.round(best) : null;
  });
}

const api = { draw, redraw, clear, probe, overlayOffsets, FILL };

declare global {
  interface Window {
    __trialHl: typeof api;
  }
}

window.__trialHl = api;

/** Hooks for the keyboard check in `trial/src/a11y.ts`. */
let live: TextAnnotator<QuoteAnnotation, W3CAnnotation> | undefined;
const recogitoApi = {
  create(container: HTMLElement) {
    live = createTextAnnotator<QuoteAnnotation, W3CAnnotation>(container, {
      adapter: createW3CQuoteAdapter(),
      selectorReviveFn: quoteReviveFn(0),
      annotatingEnabled: true,
    });
    return live;
  },
  count: () => live?.state.store.all().length ?? -1,
  // From the selection handler in @recogito/text-annotator 4.3.7: these key
  // combinations are tracked as selection keys, and the annotation is created
  // when Shift is released over a non-collapsed selection.
  hotkeys: () => ['shift+up', 'shift+down', 'shift+left', 'shift+right', 'ctrl+a / ⌘+a'],
};

declare global {
  interface Window {
    __trialRecogito: typeof recogitoApi;
  }
}

window.__trialRecogito = recogitoApi;
