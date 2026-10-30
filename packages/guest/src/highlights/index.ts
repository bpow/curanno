/**
 * Highlight rendering (ADR 0017): the CSS Custom Highlight API where it
 * exists, an overlay of positioned boxes elsewhere. Neither wraps or
 * otherwise modifies the host page's text nodes.
 */
import { createCssHighlightRenderer, supportsCssHighlights } from './css-highlights.js';
import { createOverlayRenderer } from './overlay.js';
import type { HighlightEntry, HighlightRenderer } from './types.js';

export { createCssHighlightRenderer, supportsCssHighlights } from './css-highlights.js';
export { createOverlayRenderer } from './overlay.js';
export { GUEST_ATTRIBUTE, type HighlightEntry, type HighlightRenderer } from './types.js';

export function createHighlightRenderer(doc: Document, root: Element): HighlightRenderer {
  const view = doc.defaultView as Window & typeof globalThis;
  return supportsCssHighlights(view)
    ? createCssHighlightRenderer(doc)
    : createOverlayRenderer(doc, root);
}

/**
 * Hit testing for hover and click: the identifiers of every entry with a
 * client rect under the viewport point. Rects are read from the ranges,
 * which cost a layout per call, so callers throttle and cache.
 */
export class HighlightIndex {
  private rects: { id: string; rect: DOMRect }[] | undefined;

  constructor(private entries: HighlightEntry[] = []) {}

  set(entries: HighlightEntry[]): void {
    this.entries = entries;
    this.rects = undefined;
  }

  /** Forget cached rects after scrolling, resizing or a redraw. */
  invalidate(): void {
    this.rects = undefined;
  }

  idsAt(x: number, y: number): string[] {
    this.rects ??= this.entries.flatMap((entry) =>
      entry.ranges.flatMap((range) =>
        Array.from(range.getClientRects()).map((rect) => ({ id: entry.id, rect })),
      ),
    );
    const ids = new Set<string>();
    for (const { id, rect } of this.rects) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) ids.add(id);
    }
    return [...ids];
  }
}
