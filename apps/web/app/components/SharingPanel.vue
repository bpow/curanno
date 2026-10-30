<script setup lang="ts">
import type { AclEntry, Permission, PrincipalRef } from '@curanno/api-client';
import { PERMISSIONS } from '@curanno/model';
import { computed, ref, watch } from 'vue';
import { useApi } from '../api/client';
import { useAction, useRequest } from '../composables/request';
import ProblemAlert from './ProblemAlert.vue';

const props = defineProps<{
  annotationId: string;
  /** The creator keeps every permission (ADR 0006); their row is shown but fixed. */
  creatorId?: string;
}>();
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const acl = useRequest(
  () => api.GET('/x/annotations/{id}/acl', { params: { path: { id: props.annotationId } } }),
  [() => props.annotationId],
);
const action = useAction();
/** Bumped on every reload so that checkboxes re-sync with the ACL after a refused change. */
const version = ref(0);

interface Row {
  principal: PrincipalRef;
  granted: Set<Permission>;
}

const rows = computed<Row[]>(() => {
  const byId = new Map<string, Row>();
  for (const entry of acl.data.value ?? []) {
    const row = byId.get(entry.principal.id) ?? { principal: entry.principal, granted: new Set() };
    row.granted.add(entry.permission);
    byId.set(entry.principal.id, row);
  }
  return [...byId.values()];
});

const nameOf = (p: PrincipalRef): string => p.name ?? p.kind;

async function changed(): Promise<void> {
  await acl.run();
  version.value += 1;
  emit('changed');
}

async function toggle(principal: PrincipalRef, permission: Permission, grant: boolean) {
  if (grant) {
    await action.perform(() =>
      api.POST('/x/annotations/{id}/acl', {
        params: { path: { id: props.annotationId } },
        body: { principal: principal.id, permission },
      }),
    );
  } else {
    await action.perform(() =>
      api.DELETE('/x/annotations/{id}/acl/{principalId}/{permission}', {
        params: { path: { id: props.annotationId, principalId: principal.id, permission } },
      }),
    );
  }
  await changed();
}

const query = ref('');
const candidates = ref<PrincipalRef[]>([]);
const searching = ref(false);

watch(query, async (q) => {
  if (!q.trim()) {
    candidates.value = [];
    return;
  }
  searching.value = true;
  const result = await api.GET('/x/principals', { params: { query: { q: q.trim(), limit: 10 } } });
  searching.value = false;
  if (query.value !== q) return;
  const present = new Set(rows.value.map((r) => r.principal.id));
  candidates.value = (result.data ?? []).filter((p) => !present.has(p.id));
});

async function share(principal: PrincipalRef): Promise<void> {
  await toggle(principal, 'read', true);
  if (!action.problem.value) {
    query.value = '';
    candidates.value = [];
  }
}

const has = (entries: AclEntry[] | null, id: string, permission: Permission): boolean =>
  (entries ?? []).some((e) => e.principal.id === id && e.permission === permission);
</script>

<template>
  <section class="sharing">
    <ProblemAlert :problem="acl.problem.value ?? action.problem.value" />
    <table v-if="acl.data.value">
      <thead>
        <tr>
          <th>Principal</th>
          <th v-for="permission in PERMISSIONS" :key="permission">{{ permission }}</th>
        </tr>
      </thead>
      <tbody :key="version">
        <tr v-for="row in rows" :key="row.principal.id">
          <td>
            {{ nameOf(row.principal) }}
            <span class="badge">{{ row.principal.kind }}</span>
            <span v-if="row.principal.id === creatorId" class="badge">creator</span>
          </td>
          <td v-for="permission in PERMISSIONS" :key="permission">
            <input
              type="checkbox"
              :aria-label="`${permission} for ${nameOf(row.principal)}`"
              :checked="has(acl.data.value, row.principal.id, permission)"
              :disabled="action.busy.value || row.principal.id === creatorId"
              @change="
                toggle(row.principal, permission, ($event.target as HTMLInputElement).checked)
              "
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="acl.pending.value" class="muted">Loading permissions…</p>

    <form class="inline" @submit.prevent>
      <label class="field">
        Share with
        <input
          v-model="query"
          type="search"
          placeholder="User, group, public…"
          autocomplete="off"
        />
      </label>
      <ul
        v-if="candidates.length > 0"
        class="candidates"
        role="listbox"
        aria-label="Principals found"
      >
        <li v-for="candidate in candidates" :key="candidate.id">
          <button type="button" :disabled="action.busy.value" @click="share(candidate)">
            {{ nameOf(candidate) }} <span class="badge">{{ candidate.kind }}</span>
          </button>
        </li>
      </ul>
      <span v-else-if="query.trim() && !searching" class="muted">No principals match.</span>
    </form>
  </section>
</template>

<style scoped>
.candidates {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
}
</style>
