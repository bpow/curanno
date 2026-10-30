/**
 * Reports the user's selection through `selectionchange`, debounced, so
 * keyboard and assistive-technology selections count like pointer ones
 * (ADR 0017). While a pointer button is down the report waits for the
 * release, so a drag produces one event rather than one per pixel.
 */

export interface SelectionObserverOptions {
  /** Only selections that intersect this element are reported. */
  root: Element;
  /** Elements whose subtrees are the guest's own. */
  isOwned: (node: Node) => boolean;
  /** The current selection as a range, or null when there is none. */
  onChange: (range: Range | null) => void;
  debounceMs?: number;
}

export function observeSelection(doc: Document, options: SelectionObserverOptions): () => void {
  const delay = options.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointerDown = false;
  let pending = false;

  const current = (): Range | null => {
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      if (range.collapsed || options.isOwned(range.commonAncestorContainer)) continue;
      if (!range.intersectsNode(options.root)) continue;
      return range;
    }
    return null;
  };

  const report = (): void => {
    timer = undefined;
    if (pointerDown) {
      pending = true;
      return;
    }
    pending = false;
    options.onChange(current());
  };
  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(report, delay);
  };
  const onPointerDown = (): void => {
    pointerDown = true;
  };
  const onPointerUp = (): void => {
    pointerDown = false;
    if (pending) schedule();
  };

  doc.addEventListener('selectionchange', schedule);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointerup', onPointerUp, true);
  doc.addEventListener('pointercancel', onPointerUp, true);

  return () => {
    doc.removeEventListener('selectionchange', schedule);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);
    if (timer !== undefined) clearTimeout(timer);
  };
}
