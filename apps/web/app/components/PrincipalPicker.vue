<script setup lang="ts">
import type { PrincipalRef } from '@curanno/api-client';
import {
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteRoot,
} from 'reka-ui';
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
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
const candidates = ref<PrincipalRef[]>([]);
const searching = ref(false);
/** The last search got no answer: the request failed or the API refused it. */
const failed = ref(false);
/** Whether the list would show if it had anything in it: typing opens it, Escape and a pick close it. */
const wanted = ref(false);
const open = computed(() => wanted.value && candidates.value.length > 0);
/** Reka keeps naming the last highlighted option after the list closes and it is gone. */
const closedList = computed(() => (open.value ? {} : { 'aria-activedescendant': undefined }));
const root = useTemplateRef<{ highlightFirstItem?: () => void }>('root');

const nameOf = (p: PrincipalRef): string => p.name ?? p.kind;

const DEBOUNCE_MS = 200;
let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;
onBeforeUnmount(() => clearTimeout(timer));

watch(query, (text) => {
  clearTimeout(timer);
  const q = text.trim();
  if (!q) {
    latest++;
    candidates.value = [];
    searching.value = false;
    failed.value = false;
    return;
  }
  // Waiting out the debounce counts as searching, so no-match is not claimed early.
  searching.value = true;
  failed.value = false;
  timer = setTimeout(() => void search(q), DEBOUNCE_MS);
});

async function search(q: string): Promise<void> {
  const request = ++latest;
  let found: PrincipalRef[] | undefined;
  try {
    found = (await api.GET('/x/principals', { params: { query: { q, limit: 10 } } })).data;
  } catch {
    found = undefined;
  }
  if (request !== latest) return;
  searching.value = false;
  failed.value = found === undefined;
  candidates.value = (found ?? []).filter((p) => props.offer(p));
  // There is no free-text case, so Enter takes the first match unless another is chosen.
  await nextTick();
  root.value?.highlightFirstItem?.();
}

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
      <span v-else-if="query.trim() && !searching && candidates.length === 0" class="muted">
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
