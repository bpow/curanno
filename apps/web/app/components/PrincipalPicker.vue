<script setup lang="ts">
import type { PrincipalRef } from '@curanno/api-client';
import {
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteRoot,
} from 'reka-ui';
import { computedAsync, promiseTimeout } from '@vueuse/core';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useApi } from '../api/client';

/** A search for users, groups and pseudo-principals; a pick that is added clears it for the next. */
const props = defineProps<{
  label: string;
  placeholder: string;
  /** Shown when the search finds nothing to offer. */
  noMatch: string;
  /** Which of the principals found may be picked. */
  offer: (principal: PrincipalRef) => boolean;
  /** Acts on a pick; whether it worked. A failed one keeps the search, to try again. */
  add: (principal: PrincipalRef) => Promise<boolean>;
  busy?: boolean;
}>();

const api = useApi();
const query = ref('');
const loading = ref(false);
/**
 * The answer for the latest query only, once typing pauses: typing again cancels a
 * search still waiting or in flight, and an empty query clears the list at once.
 */
const result = computedAsync(
  async (onCancel) => {
    const q = query.value.trim();
    if (!q) return { q, found: [], failed: false };
    const abort = new AbortController();
    onCancel(() => abort.abort());
    await promiseTimeout(200);
    if (abort.signal.aborted) return { q, found: [], failed: false };
    try {
      const { data } = await api.GET('/x/principals', {
        params: { query: { q, limit: 10 } },
        signal: abort.signal,
      });
      return { q, found: data ?? [], failed: data === undefined };
    } catch {
      return { q, found: [], failed: true };
    }
  },
  { q: '', found: [] as PrincipalRef[], failed: false },
  { evaluating: loading },
);
const typed = computed(() => query.value.trim() !== '');
/** Until the answer for what is typed arrives, no-match is not claimed. */
const searching = computed(
  () => typed.value && (loading.value || result.value.q !== query.value.trim()),
);
/** The last search got no answer: the request failed or the API refused it. */
const failed = computed(() => typed.value && !searching.value && result.value.failed);
/** Nothing is offered while the answer is for earlier text, so Enter cannot take a stale match. */
const candidates = computed(() =>
  searching.value ? [] : result.value.found.filter((p) => props.offer(p)),
);
/** Whether the list would show if it had anything in it: typing opens it, Escape and a pick close it. */
const wanted = ref(false);
const open = computed(() => wanted.value && candidates.value.length > 0);
/** Reka keeps naming the last highlighted option after the list closes and it is gone. */
const closedList = computed(() => (open.value ? {} : { 'aria-activedescendant': undefined }));
const root = useTemplateRef<{ highlightFirstItem?: () => void }>('root');

const nameOf = (p: PrincipalRef): string => p.name ?? p.kind;

// There is no free-text case, so Enter takes the first match unless another is chosen.
watch(result, async () => {
  await nextTick();
  root.value?.highlightFirstItem?.();
});

async function pick(event: Event, principal: PrincipalRef): Promise<void> {
  // The pick is handed on; the input is not filled with it.
  event.preventDefault();
  if (!(await props.add(principal))) return;
  query.value = '';
  wanted.value = false;
}
</script>

<template>
  <AutocompleteRoot
    ref="root"
    v-model="query"
    :open="open"
    ignore-filter
    @update:open="wanted = $event"
  >
    <div class="picker">
      <label class="field">
        {{ label }}
        <AutocompleteInput type="search" :placeholder="placeholder" v-bind="closedList" />
      </label>
      <AutocompleteContent class="candidates" :aria-label="`${label}: matches`">
        <AutocompleteItem
          v-for="candidate in candidates"
          :key="candidate.id"
          :value="candidate.id"
          :text-value="nameOf(candidate)"
          :disabled="busy"
          class="candidate"
          @select="pick($event, candidate)"
        >
          <slot :principal="candidate">{{ candidate.name ?? candidate.id }}</slot>
        </AutocompleteItem>
      </AutocompleteContent>
      <span v-if="failed" class="muted">The search failed; try again.</span>
      <span v-else-if="typed && !searching && candidates.length === 0" class="muted">
        {{ noMatch }}
      </span>
    </div>
  </AutocompleteRoot>
</template>

<style scoped>
.picker {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
}

.picker :deep(.candidates) {
  position: absolute;
  z-index: 10;
  top: 100%;
  left: 0;
  min-width: 16rem;
  margin: 0.1rem 0 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 16rem;
  overflow-y: auto;
}

.picker :deep(.candidate) {
  padding: 0.3rem 0.6rem;
  cursor: pointer;
}

.picker :deep(.candidate[data-highlighted]) {
  background: var(--panel);
}

.picker :deep(.candidate[data-disabled]) {
  color: var(--muted);
  cursor: default;
}
</style>
