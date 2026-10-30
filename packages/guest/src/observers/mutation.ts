/**
 * Watches the anchoring root for changes that can move text: structure,
 * character data and the attributes the text model reads. Changes inside
 * elements the guest owns are ignored. Callers re-extract, re-anchor and
 * redraw when `onChange` fires, which is debounced because frameworks
 * patch the DOM in bursts.
 */

export interface MutationObserverOptions {
  /** Elements whose subtrees are the guest's own. */
  isOwned: (node: Node) => boolean;
  onChange: () => void;
  debounceMs?: number;
}

/** Attributes that change whether or how an element's text counts (ADR 0013). */
export const WATCHED_ATTRIBUTES = ['hidden', 'aria-hidden', 'style', 'class', 'data-annotatable'];

export function observeMutations(root: Element, options: MutationObserverOptions): () => void {
  const view = root.ownerDocument.defaultView as Window & typeof globalThis;
  const delay = options.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const relevant = (record: MutationRecord): boolean => {
    if (options.isOwned(record.target)) return false;
    if (record.type !== 'childList') return true;
    const touched = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return touched.some((node) => !options.isOwned(node));
  };

  const observer = new view.MutationObserver((records) => {
    if (!records.some(relevant)) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      options.onChange();
    }, delay);
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES,
  });

  return () => {
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  };
}
