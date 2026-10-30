/**
 * Highlights through the CSS Custom Highlight API: no DOM footprint, and
 * the browser tracks scrolling and reflow (ADR 0017). Two registered
 * highlights, one for every annotation and one layered on top for the
 * focused ones; the style sheet gives them colours, and a text decoration
 * so they survive forced-colors mode.
 */
import { GUEST_ATTRIBUTE, type HighlightEntry, type HighlightRenderer } from './types.js';

export const HIGHLIGHT_NAME = 'scale-annotation';
export const FOCUS_HIGHLIGHT_NAME = 'scale-annotation-focus';

const STYLE = `
::highlight(${HIGHLIGHT_NAME}) {
  background-color: rgba(255, 230, 0, 0.45);
  text-decoration: underline;
  text-decoration-color: rgba(200, 160, 0, 0.9);
}
::highlight(${FOCUS_HIGHLIGHT_NAME}) {
  background-color: rgba(255, 170, 0, 0.75);
  text-decoration: underline;
  text-decoration-color: rgb(160, 90, 0);
}
@media (forced-colors: active) {
  ::highlight(${HIGHLIGHT_NAME}), ::highlight(${FOCUS_HIGHLIGHT_NAME}) {
    forced-color-adjust: none;
    background-color: Mark;
    color: MarkText;
    text-decoration: underline double;
  }
}
`;

export function supportsCssHighlights(view: Window & typeof globalThis): boolean {
  return (
    typeof view.Highlight === 'function' &&
    typeof view.CSS !== 'undefined' &&
    'highlights' in view.CSS &&
    view.CSS.highlights !== undefined
  );
}

export function createCssHighlightRenderer(doc: Document): HighlightRenderer {
  const view = doc.defaultView as Window & typeof globalThis;
  const registry = view.CSS.highlights;
  const style = doc.createElement('style');
  style.setAttribute(GUEST_ATTRIBUTE, 'style');
  style.textContent = STYLE;
  doc.head.appendChild(style);
  let entries: HighlightEntry[] = [];

  const all = new view.Highlight();
  const focused = new view.Highlight();
  focused.priority = 1;
  registry.set(HIGHLIGHT_NAME, all);
  registry.set(FOCUS_HIGHLIGHT_NAME, focused);

  return {
    technique: 'css-highlight',
    set(next) {
      entries = next;
      all.clear();
      for (const entry of entries) for (const range of entry.ranges) all.add(range);
    },
    focus(ids) {
      focused.clear();
      for (const entry of entries) {
        if (!ids.has(entry.id)) continue;
        for (const range of entry.ranges) focused.add(range);
      }
    },
    refresh() {
      // The browser repaints registered ranges itself.
    },
    dispose() {
      registry.delete(HIGHLIGHT_NAME);
      registry.delete(FOCUS_HIGHLIGHT_NAME);
      style.remove();
    },
  };
}
