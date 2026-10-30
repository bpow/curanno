<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';
import { useApi } from '../../api/client';
import AnnotationSummary from '../../components/AnnotationSummary.vue';
import ResultPager from '../../components/ResultPager.vue';
import ProblemAlert from '../../components/ProblemAlert.vue';
import { useRequest } from '../../composables/request';

definePageMeta({ middleware: 'auth' });

/** The documented filters of `GET /x/search`, carried in the page's query string. */
const FILTERS = [
  'uri',
  'text',
  'motivation',
  'purpose',
  'profile',
  'creator',
  'state',
  'parent',
  'since',
  'until',
] as const;
type Filter = (typeof FILTERS)[number];
const LIMIT = 20;

const api = useApi();
const route = useRoute();

const str = (key: string): string => (typeof route.query[key] === 'string' ? route.query[key] : '');
const query = computed(() => {
  const q: Record<string, string> = {};
  for (const key of FILTERS) if (str(key)) q[key] = str(key);
  q['sort'] = str('sort') === 'modified' ? 'modified' : 'created';
  q['order'] = str('order') === 'asc' ? 'asc' : 'desc';
  return q;
});
const offset = computed(() => Number(route.query['offset'] ?? 0) || 0);

const form = reactive<Record<Filter | 'sort' | 'order', string>>({
  uri: '',
  text: '',
  motivation: '',
  purpose: '',
  profile: '',
  creator: '',
  state: '',
  parent: '',
  since: '',
  until: '',
  sort: 'created',
  order: 'desc',
});
watch(
  query,
  (q) => {
    for (const key of FILTERS) form[key] = q[key] ?? '';
    form.sort = q['sort'] ?? 'created';
    form.order = q['order'] ?? 'desc';
  },
  { immediate: true },
);

const results = useRequest(
  () =>
    api.GET('/x/search', {
      params: {
        query: {
          ...(query.value as Record<string, string> & { sort?: 'created' | 'modified' }),
          limit: LIMIT,
          offset: offset.value,
        },
      },
    }),
  [query, offset],
);

function submit(): void {
  const next: Record<string, string> = {};
  for (const key of FILTERS) if (form[key].trim()) next[key] = form[key].trim();
  if (form.sort !== 'created') next['sort'] = form.sort;
  if (form.order !== 'desc') next['order'] = form.order;
  void navigateTo({ path: '/browse', query: next });
}
const page = (next: number) =>
  navigateTo({ path: '/browse', query: { ...route.query, offset: next } });
</script>

<template>
  <section>
    <h1>Annotations</h1>
    <form class="filters" @submit.prevent="submit">
      <label class="field wide">
        Document URI
        <input v-model="form.uri" type="url" placeholder="https://…" />
      </label>
      <label class="field wide">
        Text
        <input v-model="form.text" type="search" placeholder="Words in bodies or quotes" />
      </label>
      <label class="field">
        Motivation
        <input v-model="form.motivation" type="text" list="motivations" />
      </label>
      <label class="field">
        Body purpose
        <input v-model="form.purpose" type="text" list="motivations" />
      </label>
      <label class="field">
        Body profile IRI
        <input v-model="form.profile" type="url" />
      </label>
      <label class="field">
        Creator (user id)
        <input v-model="form.creator" type="text" />
      </label>
      <label class="field">
        Anchoring state
        <select v-model="form.state">
          <option value="">any</option>
          <option value="anchored">anchored</option>
          <option value="orphaned">orphaned</option>
          <option value="ambiguous">ambiguous</option>
          <option value="repaired">repaired</option>
        </select>
      </label>
      <label class="field">
        Replies to (annotation id)
        <input v-model="form.parent" type="text" />
      </label>
      <label class="field">
        Modified since
        <input v-model="form.since" type="datetime-local" />
      </label>
      <label class="field">
        Modified before
        <input v-model="form.until" type="datetime-local" />
      </label>
      <label class="field">
        Sort by
        <select v-model="form.sort">
          <option value="created">created</option>
          <option value="modified">modified</option>
        </select>
      </label>
      <label class="field">
        Order
        <select v-model="form.order">
          <option value="desc">newest first</option>
          <option value="asc">oldest first</option>
        </select>
      </label>
      <datalist id="motivations">
        <option
          v-for="m in [
            'commenting',
            'tagging',
            'highlighting',
            'replying',
            'questioning',
            'assessing',
            'describing',
            'linking',
            'classifying',
            'bookmarking',
            'editing',
            'identifying',
            'moderating',
          ]"
          :key="m"
          :value="m"
        />
      </datalist>
      <div class="actions">
        <button type="submit" class="primary">Search</button>
        <button type="button" @click="navigateTo('/browse')">Clear</button>
      </div>
    </form>

    <ProblemAlert :problem="results.problem.value" />
    <template v-if="results.data.value">
      <ResultPager
        :total="results.data.value.total"
        :offset="offset"
        :limit="LIMIT"
        @change="page"
      />
      <AnnotationSummary
        v-for="annotation in results.data.value.items"
        :key="annotation.id"
        :annotation="annotation"
        link
      />
      <p v-if="results.data.value.items.length === 0" class="muted">No annotations match.</p>
      <ResultPager
        v-if="results.data.value.total > LIMIT"
        :total="results.data.value.total"
        :offset="offset"
        :limit="LIMIT"
        @change="page"
      />
    </template>
    <p v-else-if="results.pending.value" class="muted">Searching…</p>
  </section>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.6rem 1rem;
  align-items: end;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.filters .wide {
  grid-column: span 2;
}

.filters .actions {
  display: flex;
  gap: 0.5rem;
}
</style>
