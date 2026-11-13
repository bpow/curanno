/**
 * Highlights through the CSS Custom Highlight API: no DOM footprint, and
 * the browser tracks scrolling and reflow (ADR 0017). Annotations and
 * suggestions (ADR 0033) are separate registered highlights, and a third,
 * layered on top, holds the focused ones; the style sheet gives them
 * colours, and a text decoration so they survive forced-colors mode.
 */
import { GUEST_ATTRIBUTE, type HighlightEntry, type HighlightRenderer } from './types.js';

export const HIGHLIGHT_NAME = 'curanno-annotation';
export const FOCUS_HIGHLIGHT_NAME = 'curanno-annotation-focus';
export const SUGGESTION_HIGHLIGHT_NAME = 'curanno-suggestion';

const STYLE = `
::highlight(${HIGHLIGHT_NAME}) {
  background-color: rgba(255, 230, 0, 0.45);
  text-decoration: underline;
  text-decoration-color: rgba(200, 160, 0, 0.9);
}
::highlight(${SUGGESTION_HIGHLIGHT_NAME}) {
  background-color: rgba(80, 140, 255, 0.12);
  text-decoration: underline dashed;
  text-decoration-color: rgb(40, 90, 200);
  text-decoration-thickness: 2px;
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
  ::highlight(${SUGGESTION_HIGHLIGHT_NAME}) {
    forced-color-adjust: none;
    text-decoration: underline dashed;
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
  const suggested = new view.Highlight();
  const focused = new view.Highlight();
  focused.priority = 1;
  const register = (): void => {
    registry.set(HIGHLIGHT_NAME, all);
    registry.set(SUGGESTION_HIGHLIGHT_NAME, suggested);
    registry.set(FOCUS_HIGHLIGHT_NAME, focused);
  };
  const unregister = (): void => {
    registry.delete(HIGHLIGHT_NAME);
    registry.delete(SUGGESTION_HIGHLIGHT_NAME);
    registry.delete(FOCUS_HIGHLIGHT_NAME);
  };
  register();

  return {
    technique: 'css-highlight',
    set(next) {
      entries = next;
      all.clear();
      suggested.clear();
      for (const entry of entries) {
        for (const range of entry.ranges) (entry.suggested ? suggested : all).add(range);
      }
    },
    focus(ids) {
      focused.clear();
      for (const entry of entries) {
        if (!ids.has(entry.id)) continue;
        for (const range of entry.ranges) focused.add(range);
      }
    },
    setVisible(visible) {
      if (visible) register();
      else unregister();
    },
    refresh() {
      // The browser repaints registered ranges itself.
    },
    dispose() {
      unregister();
      style.remove();
    },
  };
}
