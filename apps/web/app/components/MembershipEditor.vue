<script setup lang="ts">
import type { GroupRole, Membership, PrincipalRef } from '@scale/api-client';
import { ref, watch } from 'vue';
import { NuxtLink } from '#components';
import { useApi } from '../api/client';
import { useAction, useRequest } from '../composables/request';
import { formatDate } from '../util/time';
import ProblemAlert from './ProblemAlert.vue';

const props = defineProps<{
  groupId: string;
  /** Whether the caller may add, remove and re-role members. */
  canManage: boolean;
  /** The caller, who may always remove themself. */
  currentUserId?: string;
}>();
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const members = useRequest(
  () => api.GET('/x/groups/{id}/members', { params: { path: { id: props.groupId } } }),
  [() => props.groupId],
);
const action = useAction();

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
  const memberIds = new Set((members.data.value ?? []).map((m) => m.user.id));
  candidates.value = (result.data ?? []).filter((p) => p.kind === 'user' && !memberIds.has(p.id));
});

async function changed(): Promise<void> {
  await members.run();
  emit('changed');
}

async function add(principal: PrincipalRef): Promise<void> {
  const ok = await action.perform(() =>
    api.PUT('/x/groups/{id}/members/{userId}', {
      params: { path: { id: props.groupId, userId: principal.id } },
      body: { role: 'member' },
    }),
  );
  if (ok !== undefined || !action.problem.value) {
    query.value = '';
    candidates.value = [];
    await changed();
  }
}

async function setRole(member: Membership, role: GroupRole): Promise<void> {
  await action.perform(() =>
    api.PUT('/x/groups/{id}/members/{userId}', {
      params: { path: { id: props.groupId, userId: member.user.id } },
      body: { role },
    }),
  );
  if (!action.problem.value) await changed();
}

async function remove(member: Membership): Promise<void> {
  const name = member.user.displayName ?? member.user.id;
  if (!window.confirm(`Remove ${name} from the group?`)) return;
  await action.perform(() =>
    api.DELETE('/x/groups/{id}/members/{userId}', {
      params: { path: { id: props.groupId, userId: member.user.id } },
    }),
  );
  if (!action.problem.value) await changed();
}

const canRemove = (member: Membership): boolean =>
  props.canManage || member.user.id === props.currentUserId;
</script>

<template>
  <section class="membership">
    <ProblemAlert :problem="members.problem.value ?? action.problem.value" />
    <table v-if="members.data.value">
      <thead>
        <tr>
          <th>Member</th>
          <th>Role</th>
          <th>Added</th>
          <th v-if="canManage || currentUserId"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="member in members.data.value" :key="member.user.id">
          <td>
            <NuxtLink :to="`/users/${member.user.id}`">{{
              member.user.displayName ?? member.user.id
            }}</NuxtLink>
          </td>
          <td>
            <select
              v-if="canManage"
              :aria-label="`Role of ${member.user.displayName ?? member.user.id}`"
              :value="member.role"
              :disabled="action.busy.value"
              @change="setRole(member, ($event.target as HTMLSelectElement).value as GroupRole)"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <template v-else>{{ member.role }}</template>
          </td>
          <td class="muted">{{ formatDate(member.addedAt) }}</td>
          <td v-if="canManage || currentUserId">
            <button
              v-if="canRemove(member)"
              type="button"
              class="link danger"
              :disabled="action.busy.value"
              @click="remove(member)"
            >
              {{ member.user.id === currentUserId ? 'Leave' : 'Remove' }}
            </button>
          </td>
        </tr>
        <tr v-if="members.data.value.length === 0">
          <td colspan="4" class="muted">No members.</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="members.pending.value" class="muted">Loading members…</p>

    <form v-if="canManage" class="inline" @submit.prevent>
      <label class="field">
        Add member
        <input v-model="query" type="search" placeholder="Name or email" autocomplete="off" />
      </label>
      <ul v-if="candidates.length > 0" class="candidates" role="listbox" aria-label="Users found">
        <li v-for="candidate in candidates" :key="candidate.id">
          <button type="button" :disabled="action.busy.value" @click="add(candidate)">
            {{ candidate.name ?? candidate.id }}
          </button>
        </li>
      </ul>
      <span v-else-if="query.trim() && !searching" class="muted">No users match.</span>
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
