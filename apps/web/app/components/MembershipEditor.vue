<script setup lang="ts">
import type { GroupRole, Membership, PrincipalRef } from '@curanno/api-client';
import { NuxtLink } from '#components';
import { useApi } from '../api/client';
import { useAction, useRequest } from '../composables/request';
import { formatDate } from '../util/time';
import ConfirmDialog from './ConfirmDialog.vue';
import PrincipalPicker from './PrincipalPicker.vue';
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

/** Groups cannot be members, and members are not offered again. */
const offer = (p: PrincipalRef): boolean =>
  p.kind === 'user' && !(members.data.value ?? []).some((m) => m.user.id === p.id);

async function changed(): Promise<void> {
  await members.run();
  emit('changed');
}

async function add(principal: PrincipalRef): Promise<boolean> {
  await action.perform(() =>
    api.PUT('/x/groups/{id}/members/{userId}', {
      params: { path: { id: props.groupId, userId: principal.id } },
      body: { role: 'member' },
    }),
  );
  if (action.problem.value) return false;
  await changed();
  return true;
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
            <ConfirmDialog
              v-if="canRemove(member)"
              :title="
                member.user.id === currentUserId
                  ? 'Leave the group?'
                  : `Remove ${member.user.displayName ?? member.user.id} from the group?`
              "
              :description="`Permissions granted to the group stop applying to ${
                member.user.id === currentUserId ? 'you' : 'them'
              }.`"
              :action="member.user.id === currentUserId ? 'Leave' : 'Remove'"
              @confirm="remove(member)"
            >
              <button type="button" class="link danger" :disabled="action.busy.value">
                {{ member.user.id === currentUserId ? 'Leave' : 'Remove' }}
              </button>
            </ConfirmDialog>
          </td>
        </tr>
        <tr v-if="members.data.value.length === 0">
          <td colspan="4" class="muted">No members.</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="members.pending.value" class="muted">Loading members…</p>

    <PrincipalPicker
      v-if="canManage"
      label="Add member"
      placeholder="Name or email"
      no-match="No users match."
      :offer="offer"
      :busy="action.busy.value"
      :add="add"
    />
  </section>
</template>
