<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NuxtLink } from '#components';
import { definePageMeta, navigateTo, useRoute } from '#imports';
import { useApi } from '../../api/client';
import ResultPager from '../../components/ResultPager.vue';
import ProblemAlert from '../../components/ProblemAlert.vue';
import { useAuth } from '../../composables/auth';
import { useAction, useRequest } from '../../composables/request';

definePageMeta({ middleware: 'auth' });

const LIMIT = 50;
const api = useApi();
const auth = useAuth();
const route = useRoute();
const q = computed(() => (typeof route.query['q'] === 'string' ? route.query['q'] : ''));
const offset = computed(() => Number(route.query['offset'] ?? 0) || 0);
const draft = ref(q.value);
watch(q, (value) => (draft.value = value));

const groups = useRequest(
  () =>
    api.GET('/x/groups', {
      params: { query: { ...(q.value ? { q: q.value } : {}), limit: LIMIT, offset: offset.value } },
    }),
  [q, offset],
);

const search = () =>
  navigateTo({ path: '/groups', query: draft.value.trim() ? { q: draft.value.trim() } : {} });
const page = (next: number) =>
  navigateTo({ path: '/groups', query: { ...(q.value ? { q: q.value } : {}), offset: next } });

const create = useAction();
const newName = ref('');
const newDescription = ref('');
async function createGroup(): Promise<void> {
  const group = await create.perform(() =>
    api.POST('/x/groups', {
      body: {
        name: newName.value.trim(),
        ...(newDescription.value.trim() ? { description: newDescription.value.trim() } : {}),
      },
    }),
  );
  if (group) await navigateTo(`/groups/${group.id}`);
}
</script>

<template>
  <section>
    <h1>Groups</h1>
    <p class="muted">
      {{ auth.isAdmin.value ? 'Every group on this instance.' : 'The groups you belong to.' }}
    </p>
    <form class="inline" @submit.prevent="search">
      <label class="field">
        Name
        <input v-model="draft" type="search" />
      </label>
      <button type="submit">Search</button>
    </form>
    <ProblemAlert :problem="groups.problem.value" />
    <template v-if="groups.data.value">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Members</th>
            <th>Your role</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in groups.data.value.items" :key="group.id">
            <td>
              <NuxtLink :to="`/groups/${group.id}`">{{ group.name }}</NuxtLink>
            </td>
            <td class="muted">{{ group.description ?? '' }}</td>
            <td>{{ group.memberCount ?? '' }}</td>
            <td>{{ group.role ?? '' }}</td>
          </tr>
          <tr v-if="groups.data.value.items.length === 0">
            <td colspan="4" class="muted">No groups.</td>
          </tr>
        </tbody>
      </table>
      <ResultPager
        :total="groups.data.value.total"
        :offset="offset"
        :limit="LIMIT"
        @change="page"
      />
    </template>
    <p v-else-if="groups.pending.value" class="muted">Loading…</p>

    <h2>New group</h2>
    <form class="inline" @submit.prevent="createGroup">
      <label class="field">
        Name
        <input v-model="newName" type="text" required />
      </label>
      <label class="field">
        Description
        <input v-model="newDescription" type="text" />
      </label>
      <button type="submit" class="primary" :disabled="create.busy.value">Create</button>
    </form>
    <ProblemAlert :problem="create.problem.value" />
  </section>
</template>
