<script setup lang="ts">
import {
  type AclEntry,
  type PrincipalRef,
  toProblem,
  unwrap,
  type Problem,
} from '@curanno/api-client';
import { PERMISSIONS, type Permission } from '@curanno/model';
import {
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteRoot,
} from 'reka-ui';
import { computedAsync, promiseTimeout } from '@vueuse/core';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useApi } from '../api/client';
import ProblemAlert from './ProblemAlert.vue';

/**
 * The grants table and principal search. It only reports what was toggled;
 * the parent decides whether that goes to the API now or is held for later.
 */
const props = defineProps<{
  entries: AclEntry[];
  /** A user whose row is shown but cannot be changed (the creator, ADR 0006). */
  lockedId?: string | undefined;
  busy?: boolean | undefined;
}>();
const emit = defineEmits<{
  toggle: [principal: PrincipalRef, permission: Permission, grant: boolean];
}>();

const api = useApi();
const query = ref('');
/** Whether the list would show if it had anything in it: typing opens it, Escape and a pick close it. */
const wanted = ref(false);
const open = computed(() => wanted.value && candidates.value.length > 0);
/** Reka keeps naming the last highlighted option after the list closes and it is gone. */
const closedList = computed(() => (open.value ? {} : { 'aria-activedescendant': undefined }));
const root = useTemplateRef<{ highlightFirstItem?: () => void }>('root');

interface Row {
  principal: PrincipalRef;
  granted: Set<Permission>;
}

const rows = computed<Row[]>(() => {
  const byId = new Map<string, Row>();
  for (const entry of props.entries) {
    const row = byId.get(entry.principal.id) ?? { principal: entry.principal, granted: new Set() };
    row.granted.add(entry.permission);
    byId.set(entry.principal.id, row);
  }
  const order: Record<PrincipalRef['kind'], number> = {
    public: 0,
    authenticated: 1,
    group: 2,
    user: 3,
  };
  return [...byId.values()].sort(
    (a, b) =>
      order[a.principal.kind] - order[b.principal.kind] ||
      (a.principal.name ?? '').localeCompare(b.principal.name ?? ''),
  );
});

function label(principal: PrincipalRef): string {
  switch (principal.kind) {
    case 'public':
      return 'Everyone (public)';
    case 'authenticated':
      return 'Any logged-in user';
    case 'group':
      return `Group: ${principal.name ?? principal.id}`;
    default:
      return principal.name ?? principal.id;
  }
}

function isLocked(principal: PrincipalRef): boolean {
  return principal.kind === 'user' && principal.id === props.lockedId;
}

const loading = ref(false);
/**
 * The answer for the latest query only, once typing pauses: typing again cancels a
 * search still waiting or in flight, and an empty query clears the list at once.
 */
const result = computedAsync(
  async (onCancel): Promise<{ q: string; found: PrincipalRef[]; problem?: Problem }> => {
    const q = query.value.trim();
    if (!q) return { q, found: [] };
    const abort = new AbortController();
    onCancel(() => abort.abort());
    await promiseTimeout(200);
    if (abort.signal.aborted) return { q, found: [] };
    try {
      return {
        q,
        found: unwrap(
          await api.GET('/x/principals', {
            params: { query: { q, limit: 10 } },
            signal: abort.signal,
          }),
        ),
      };
    } catch (err) {
      return { q, found: [], problem: toProblem(err) };
    }
  },
  { q: '', found: [] },
  { evaluating: loading },
);
const searching = computed(
  () => query.value.trim() !== '' && (loading.value || result.value.q !== query.value.trim()),
);
const problem = computed(() => (searching.value ? undefined : result.value.problem));
/**
 * Principals already in the table are not offered again, and nothing is offered while the
 * answer is for earlier text, so Enter cannot take a match for what was typed before.
 */
const candidates = computed(() =>
  searching.value
    ? []
    : result.value.found.filter((p) => !rows.value.some((r) => r.principal.id === p.id)),
);

// There is no free-text case, so Enter takes the first match unless another is chosen.
watch(result, async () => {
  await nextTick();
  root.value?.highlightFirstItem?.();
});

function add(event: Event, principal: PrincipalRef): void {
  // The pick becomes a row in the table; the input is not filled with it.
  event.preventDefault();
  query.value = '';
  wanted.value = false;
  emit('toggle', principal, 'read', true);
}
</script>

<template>
  <div class="acl">
    <table v-if="rows.length">
      <thead>
        <tr>
          <th scope="col">Who</th>
          <th v-for="p in PERMISSIONS" :key="p" scope="col">{{ p }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.principal.id">
          <th scope="row">
            {{ label(row.principal)
            }}<span v-if="isLocked(row.principal)" class="muted"> (creator)</span>
          </th>
          <td v-for="p in PERMISSIONS" :key="p">
            <input
              type="checkbox"
              :aria-label="`${p} for ${label(row.principal)}`"
              :checked="row.granted.has(p)"
              :disabled="busy || isLocked(row.principal)"
              @change="
                emit('toggle', row.principal, p, ($event.target as HTMLInputElement).checked)
              "
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!busy" class="muted">Only you can see this annotation.</p>
    <AutocompleteRoot
      ref="root"
      v-model="query"
      :open="open"
      ignore-filter
      @update:open="wanted = $event"
    >
      <div class="add">
        <AutocompleteInput
          type="search"
          name="principal"
          placeholder="Share with a user, group, public or authenticated…"
          aria-label="Share with"
          :disabled="busy"
          v-bind="closedList"
        />
        <AutocompleteContent class="candidates" aria-label="Matching principals">
          <AutocompleteItem
            v-for="c in candidates"
            :key="c.id"
            :value="c.id"
            :text-value="label(c)"
            class="candidate"
            @select="add($event, c)"
          >
            {{ label(c) }}
          </AutocompleteItem>
        </AutocompleteContent>
      </div>
      <p v-if="searching && !open" class="muted">Searching…</p>
    </AutocompleteRoot>
    <ProblemAlert :problem="problem" />
  </div>
</template>

<style scoped>
.acl {
  display: grid;
  gap: 0.5rem;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.9em;
}

th,
td {
  text-align: left;
  padding: 0.15rem 0.3rem;
}

thead th {
  color: var(--muted);
  font-weight: normal;
  text-transform: capitalize;
}

td {
  text-align: center;
}

input[type='checkbox'] {
  width: auto;
}

.add {
  position: relative;
}

.add :deep(.candidates) {
  position: absolute;
  z-index: 10;
  top: 100%;
  left: 0;
  right: 0;
  margin: 0.1rem 0 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-height: 16rem;
  overflow-y: auto;
}

.add :deep(.candidate) {
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.add :deep(.candidate[data-highlighted]) {
  background: var(--surface-2);
}
</style>
