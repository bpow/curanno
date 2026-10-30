<script setup lang="ts">
import type { AclEntry, PrincipalRef } from '@scale/api-client';
import { PERMISSIONS, type Permission } from '@scale/model';
import { computed, onMounted, ref, watch } from 'vue';
import { useApi } from '../api/client';
import { toProblem, unwrap, type Problem } from '../api/problems';
import ProblemAlert from './ProblemAlert.vue';

const props = defineProps<{
  /** The annotation's identifier (the path parameter, not the IRI). */
  annotationId: string;
  /** The creator's user id; the creator keeps every permission. */
  creatorId?: string | undefined;
}>();

const api = useApi();
const entries = ref<AclEntry[]>([]);
const problem = ref<Problem>();
const busy = ref(false);
const query = ref('');
const candidates = ref<PrincipalRef[]>([]);
const searching = ref(false);

interface Row {
  principal: PrincipalRef;
  granted: Set<Permission>;
}

const rows = computed<Row[]>(() => {
  const byId = new Map<string, Row>();
  for (const entry of entries.value) {
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

function isCreator(principal: PrincipalRef): boolean {
  return principal.kind === 'user' && principal.id === props.creatorId;
}

async function load(): Promise<void> {
  busy.value = true;
  try {
    entries.value = unwrap(
      await api.GET('/x/annotations/{id}/acl', { params: { path: { id: props.annotationId } } }),
    );
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function toggle(principal: PrincipalRef, permission: Permission, grant: boolean) {
  busy.value = true;
  try {
    if (grant) {
      const entry = unwrap(
        await api.POST('/x/annotations/{id}/acl', {
          params: { path: { id: props.annotationId } },
          body: { principal: principal.id, permission },
        }),
      );
      entries.value = [...entries.value, entry];
    } else {
      unwrap(
        await api.DELETE('/x/annotations/{id}/acl/{principalId}/{permission}', {
          params: { path: { id: props.annotationId, principalId: principal.id, permission } },
        }),
      );
      entries.value = entries.value.filter(
        (e) => !(e.principal.id === principal.id && e.permission === permission),
      );
    }
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
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
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    searching.value = false;
  }
}

async function add(principal: PrincipalRef): Promise<void> {
  query.value = '';
  candidates.value = [];
  await toggle(principal, 'read', true);
}

onMounted(() => void load());
</script>

<template>
  <section class="sharing" aria-label="Sharing">
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
            }}<span v-if="isCreator(row.principal)" class="muted"> (creator)</span>
          </th>
          <td v-for="p in PERMISSIONS" :key="p">
            <input
              type="checkbox"
              :aria-label="`${p} for ${label(row.principal)}`"
              :checked="row.granted.has(p)"
              :disabled="busy || isCreator(row.principal)"
              @change="toggle(row.principal, p, ($event.target as HTMLInputElement).checked)"
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
      <ul v-if="candidates.length" class="candidates" role="listbox">
        <li v-for="c in candidates" :key="c.id">
          <button type="button" class="link" @click="add(c)">{{ label(c) }}</button>
        </li>
      </ul>
      <p v-else-if="searching" class="muted">Searching…</p>
    </div>
    <ProblemAlert :problem="problem" />
  </section>
</template>

<style scoped>
.sharing {
  margin: 0.4rem 0;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
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
