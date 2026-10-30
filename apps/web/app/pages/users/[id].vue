<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { definePageMeta, useRoute } from '#imports';
import { useApi } from '../../api/client';
import ProblemAlert from '../../components/ProblemAlert.vue';
import UserCard from '../../components/UserCard.vue';
import { useAuth } from '../../composables/auth';
import { useAction, useRequest } from '../../composables/request';

definePageMeta({ middleware: 'auth' });

const api = useApi();
const auth = useAuth();
const route = useRoute();
const id = computed(() => String(route.params['id']));

const user = useRequest(
  () => api.GET('/x/users/{id}', { params: { path: { id: id.value } } }),
  [id],
);
const edit = useAction();
const displayName = ref('');
const isAdmin = ref(false);
watch(user.data, (u) => {
  displayName.value = u?.displayName ?? '';
  isAdmin.value = u?.isAdmin ?? false;
});

async function save(): Promise<void> {
  const updated = await edit.perform(() =>
    api.PATCH('/x/users/{id}', {
      params: { path: { id: id.value } },
      body: { displayName: displayName.value.trim(), isAdmin: isAdmin.value },
    }),
  );
  if (updated) {
    user.data.value = updated;
    if (updated.id === auth.me.value?.id) await auth.reloadMe();
  }
}
</script>

<template>
  <section>
    <h1>{{ user.data.value?.displayName ?? 'User' }}</h1>
    <ProblemAlert :problem="user.problem.value" />
    <template v-if="user.data.value">
      <UserCard :user="user.data.value" />
      <template v-if="auth.isAdmin.value">
        <h2>Edit</h2>
        <form class="inline" @submit.prevent="save">
          <label class="field">
            Display name
            <input v-model="displayName" type="text" required />
          </label>
          <label class="field">
            <span><input v-model="isAdmin" type="checkbox" /> Platform administrator</span>
          </label>
          <button type="submit" class="primary" :disabled="edit.busy.value">Save</button>
        </form>
        <ProblemAlert :problem="edit.problem.value" />
      </template>
    </template>
    <p v-else-if="user.pending.value" class="muted">Loading…</p>
  </section>
</template>
