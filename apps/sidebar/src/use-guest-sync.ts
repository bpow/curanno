/**
 * Keeps the guest's highlights in step with the list: every top-level
 * annotation is sent to be anchored, one whose target changed (a repair by
 * another user arriving over the event stream) is anchored again,
 * deletions are withdrawn, and a click on a highlight in the page scrolls
 * the sidebar to the card and focuses it.
 */
import { onUnmounted, watch } from 'vue';
import { annotationUuid } from './api/annotations';
import type { Guest } from './guest';
import type { useAnnotationsStore } from './stores/annotations';

export function useGuestSync(guest: Guest, store: ReturnType<typeof useAnnotationsStore>): void {
  /** What each known annotation was last asked to anchor with, by IRI. */
  const known = new Map<string, string>();
  watch(
    () => store.roots,
    (roots) => {
      const current = new Set(roots.map((a) => a.id));
      const gone = [...known.keys()].filter((id) => !current.has(id));
      for (const id of gone) known.delete(id);
      if (gone.length) guest.unanchor(gone);
      const requests = roots
        .filter((a) => known.get(a.id) !== JSON.stringify(a.target))
        .map((a) => ({ id: a.id, target: a.target }));
      for (const request of requests) known.set(request.id, JSON.stringify(request.target));
      if (requests.length) guest.anchor(requests);
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
