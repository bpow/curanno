/**
 * Keeps the guest's highlights in step with the list: every top-level
 * annotation is sent to be anchored, deletions are withdrawn, and a click on
 * a highlight in the page scrolls the sidebar to the card and focuses it.
 */
import { onUnmounted, watch } from 'vue';
import { annotationUuid } from './api/annotations';
import type { Guest } from './guest';
import type { useAnnotationsStore } from './stores/annotations';

export function useGuestSync(guest: Guest, store: ReturnType<typeof useAnnotationsStore>): void {
  let known = new Set<string>();
  watch(
    () => store.roots,
    (roots) => {
      const current = new Set(roots.map((a) => a.id));
      const gone = [...known].filter((id) => !current.has(id));
      if (gone.length) guest.unanchor(gone);
      const requests = roots
        .filter((a) => !known.has(a.id))
        .map((a) => ({ id: a.id, target: a.target }));
      if (requests.length) guest.anchor(requests);
      known = current;
    },
    { immediate: true },
  );

  const off = guest.onActivate((ids) => {
    const first = ids[0];
    if (!first) return;
    const card = document.getElementById(`annotation-${annotationUuid(first)}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card?.focus({ preventScroll: true });
  });
  onUnmounted(off);
}
