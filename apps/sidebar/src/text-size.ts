/**
 * The text size of the sidebar's content (the annotations, the composer),
 * in pixels; the toolbar keeps its own. Remembered in this origin's
 * storage, so it follows the user from page to page.
 */
import { computed, ref, watch } from 'vue';

export const TEXT_SIZES = [12, 13, 14, 16, 18, 20, 22, 24] as const;
export const DEFAULT_TEXT_SIZE = 14;
const STORAGE_KEY = 'curanno.sidebar.textSize';

function stored(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if ((TEXT_SIZES as readonly number[]).includes(value)) return value;
  } catch {
    // Storage blocked: the default it is.
  }
  return DEFAULT_TEXT_SIZE;
}

const size = ref(stored());
watch(size, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Not remembered, still applied.
  }
});

export function useTextSize() {
  const index = computed(() => (TEXT_SIZES as readonly number[]).indexOf(size.value));
  return {
    size,
    canShrink: computed(() => index.value > 0),
    canGrow: computed(() => index.value < TEXT_SIZES.length - 1),
    shrink() {
      if (index.value > 0) size.value = TEXT_SIZES[index.value - 1]!;
    },
    grow() {
      if (index.value < TEXT_SIZES.length - 1) size.value = TEXT_SIZES[index.value + 1]!;
    },
  };
}
