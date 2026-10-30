/**
 * Fallback renderer for browsers without the CSS Custom Highlight API: one
 * positioned box per client rect of each range, in a fixed, pointer-
 * transparent layer inside a shadow root. The layer is redrawn after any
 * scroll (captured, so nested scrollers count), resize or layout change,
 * which is what the Phase 2 overlay lacked. Host text nodes are never
 * touched.
 */
import { GUEST_ATTRIBUTE, type HighlightEntry, type HighlightRenderer } from './types.js';

const STYLE = `
:host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0;
  overflow: visible; pointer-events: none; z-index: 2147483646; }
.hl { position: absolute; background: rgba(255, 230, 0, 0.45); mix-blend-mode: multiply;
  border-bottom: 1px solid rgba(200, 160, 0, 0.9); box-sizing: border-box; }
.hl.focus { background: rgba(255, 170, 0, 0.75); border-bottom-color: rgb(160, 90, 0); }
@media (forced-colors: active) {
  .hl { forced-color-adjust: none; background: transparent; border-bottom: 2px double CanvasText; }
}
`;

export function createOverlayRenderer(doc: Document, root: Element): HighlightRenderer {
  const view = doc.defaultView as Window & typeof globalThis;
  const host = doc.createElement('div');
  host.setAttribute(GUEST_ATTRIBUTE, 'overlay');
  host.setAttribute('data-annotatable', 'false');
  host.setAttribute('aria-hidden', 'true');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  shadow.appendChild(style);
  const layer = doc.createElement('div');
  shadow.appendChild(layer);
  doc.body.appendChild(host);

  let entries: HighlightEntry[] = [];
  let focused: ReadonlySet<string> = new Set();
  let frame = 0;

  const draw = (): void => {
    frame = 0;
    layer.replaceChildren();
    for (const entry of entries) {
      const isFocused = focused.has(entry.id);
      for (const range of entry.ranges) {
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width === 0 || rect.height === 0) continue;
          const box = doc.createElement('div');
          box.className = isFocused ? 'hl focus' : 'hl';
          box.style.left = `${rect.left}px`;
          box.style.top = `${rect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          layer.appendChild(box);
        }
      }
    }
  };
  const schedule = (): void => {
    if (frame === 0) frame = view.requestAnimationFrame(draw);
  };

  doc.addEventListener('scroll', schedule, { capture: true, passive: true });
  view.addEventListener('resize', schedule);
  const resizeObserver =
    typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : undefined;
  resizeObserver?.observe(root);

  return {
    technique: 'overlay',
    set(next) {
      entries = next;
      schedule();
    },
    focus(ids) {
      focused = ids;
      schedule();
    },
    refresh: schedule,
    dispose() {
      if (frame !== 0) view.cancelAnimationFrame(frame);
      doc.removeEventListener('scroll', schedule, { capture: true });
      view.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
      host.remove();
    },
  };
}
