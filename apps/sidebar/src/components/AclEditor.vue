<script setup lang="ts">
import type { AclEntry, PrincipalRef } from '@curanno/api-client';
import { PERMISSIONS, type Permission } from '@curanno/model';
import { computed, ref, watch } from 'vue';
import { useApi } from '../api/client';
import { toProblem, unwrap, type Problem } from '../api/problems';
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
const candidates = ref<PrincipalRef[]>([]);
const searching = ref(false);
const problem = ref<Problem>();

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

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, (q) => {
  clearTimeout(searchTimer);
  if (!q.trim()) {
    candidates.value = [];
    return;
  }
  searchTimer = setTimeout(() => void search(q.trim()), 200);
});

async function search(q: string): Promise<void> {
  searching.value = true;
  try {
    const found = unwrap(await api.GET('/x/principals', { params: { query: { q, limit: 10 } } }));
    const present = new Set(rows.value.map((r) => r.principal.id));
    candidates.value = found.filter((p) => !present.has(p.id));
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    searching.value = false;
  }
}

function add(principal: PrincipalRef): void {
  query.value = '';
  candidates.value = [];
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
    <div class="add">
      <input
        v-model="query"
        type="search"
        name="principal"
        placeholder="Share with a user, group, public or authenticated…"
        aria-label="Share with"
        :disabled="busy"
      />
      <ul v-if="candidates.length" class="candidates" aria-label="Matching principals">
        <li v-for="c in candidates" :key="c.id">
          <button type="button" class="link" @click="add(c)">{{ label(c) }}</button>
        </li>
      </ul>
      <p v-else-if="searching" class="muted">Searching…</p>
    </div>
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

.candidates {
  list-style: none;
  margin: 0.2rem 0 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.candidates li {
  padding: 0.2rem 0.4rem;
}
</style>
