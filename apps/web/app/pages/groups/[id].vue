<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';
import { useApi } from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import MembershipEditor from '../../components/MembershipEditor.vue';
import ProblemAlert from '../../components/ProblemAlert.vue';
import { useAuth } from '../../composables/auth';
import { useAction, useRequest } from '../../composables/request';
import { formatDate } from '../../util/time';

definePageMeta({ middleware: 'auth' });

const api = useApi();
const auth = useAuth();
const route = useRoute();
const id = computed(() => String(route.params['id']));

const group = useRequest(
  () => api.GET('/x/groups/{id}', { params: { path: { id: id.value } } }),
  [id],
);
const canManage = computed(() => auth.isAdmin.value || group.data.value?.role === 'admin');

const edit = useAction();
const name = ref('');
const description = ref('');
watch(group.data, (g) => {
  name.value = g?.name ?? '';
  description.value = g?.description ?? '';
});

async function save(): Promise<void> {
  const updated = await edit.perform(() =>
    api.PATCH('/x/groups/{id}', {
      params: { path: { id: id.value } },
      body: {
        name: name.value.trim(),
        ...(description.value.trim() ? { description: description.value.trim() } : {}),
      },
    }),
  );
  if (updated) group.data.value = updated;
}

async function remove(): Promise<void> {
  await edit.perform(() => api.DELETE('/x/groups/{id}', { params: { path: { id: id.value } } }));
  if (!edit.problem.value) await navigateTo('/groups');
}
</script>

<template>
  <section>
    <h1>{{ group.data.value?.name ?? 'Group' }}</h1>
    <ProblemAlert :problem="group.problem.value" />
    <template v-if="group.data.value">
      <dl class="props">
        <dt>Description</dt>
        <dd>{{ group.data.value.description ?? '—' }}</dd>
        <dt>Members</dt>
        <dd>{{ group.data.value.memberCount ?? '—' }}</dd>
        <dt>Your role</dt>
        <dd>{{ group.data.value.role ?? 'not a member' }}</dd>
        <dt>Created</dt>
        <dd>{{ formatDate(group.data.value.created) }}</dd>
      </dl>

      <template v-if="canManage">
        <h2>Edit</h2>
        <form class="inline" @submit.prevent="save">
          <label class="field">
            Name
            <input v-model="name" type="text" required />
          </label>
          <label class="field">
            Description
            <input v-model="description" type="text" />
          </label>
          <button type="submit" class="primary" :disabled="edit.busy.value">Save</button>
          <ConfirmDialog
            :title="`Delete the group “${group.data.value.name}”?`"
            description="Permissions granted to it are removed."
            action="Delete group"
            @confirm="remove"
          >
            <button type="button" class="danger" :disabled="edit.busy.value">Delete group</button>
          </ConfirmDialog>
        </form>
        <ProblemAlert :problem="edit.problem.value" />
      </template>

      <h2>Members</h2>
      <MembershipEditor
        :group-id="group.data.value.id"
        :can-manage="canManage"
        :current-user-id="auth.me.value?.id"
        @changed="group.run()"
      />
    </template>
    <p v-else-if="group.pending.value" class="muted">Loading…</p>
  </section>
</template>
