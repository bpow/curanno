<script setup lang="ts">
import { computed, reactive } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';
import { useApi } from '../../api/client';
import ProblemAlert from '../../components/ProblemAlert.vue';
import ResultPager from '../../components/ResultPager.vue';
import { useAction, useRequest } from '../../composables/request';
import { formatDate } from '../../util/time';

// People who signed up and wait for an administrator (embedded sign-in, ADR 0028).
definePageMeta({ middleware: 'admin' });

const LIMIT = 50;
const FILTERS = ['pending', 'approved', 'rejected'] as const;
type Filter = (typeof FILTERS)[number];

const api = useApi();
const route = useRoute();
const filter = computed<Filter>(() => {
  const value = route.query['decision'];
  return FILTERS.find((f) => f === value) ?? 'pending';
});
const offset = computed(() => Number(route.query['offset'] ?? 0) || 0);
const notes = reactive<Record<string, string>>({});

const applications = useRequest(
  () =>
    api.GET('/x/applications', {
      params: { query: { decision: filter.value, limit: LIMIT, offset: offset.value } },
    }),
  [filter, offset],
);
const action = useAction();

async function decide(id: string, decision: 'approved' | 'rejected'): Promise<void> {
  const note = notes[id]?.trim();
  const done = await action.perform(() =>
    api.PATCH('/x/applications/{id}', {
      params: { path: { id } },
      body: { decision, ...(note ? { note } : {}) },
    }),
  );
  if (done) await applications.run();
}

const show = (decision: Filter) => navigateTo({ path: '/applications', query: { decision } });
const page = (next: number) =>
  navigateTo({ path: '/applications', query: { decision: filter.value, offset: next } });
</script>

<template>
  <section>
    <h1>Applications</h1>
    <nav class="tabs" aria-label="Applications by state">
      <button
        v-for="f in FILTERS"
        :key="f"
        type="button"
        :class="{ primary: f === filter }"
        :aria-pressed="f === filter"
        @click="show(f)"
      >
        {{ f }}
      </button>
    </nav>
    <ProblemAlert :problem="applications.problem.value" />
    <ProblemAlert :problem="action.problem.value" />
    <template v-if="applications.data.value">
      <ul class="applications">
        <li v-for="a in applications.data.value.items" :key="a.id">
          <p>
            <strong>{{ a.displayName ?? a.userId }}</strong>
            <span v-if="a.email">
              &lt;{{ a.email }}&gt;
              <span class="muted">{{ a.emailVerified ? '(verified)' : '(not verified)' }}</span>
            </span>
            <span class="muted"> — applied {{ formatDate(a.created) }}</span>
          </p>
          <p v-if="a.note" class="quote">{{ a.note }}</p>
          <template v-if="a.decision === 'pending'">
            <label class="field">
              Message to the applicant (optional)
              <input v-model="notes[a.id]" type="text" maxlength="2000" />
            </label>
            <div class="actions">
              <button
                type="button"
                class="primary"
                :disabled="action.busy.value"
                @click="decide(a.id, 'approved')"
              >
                Approve
              </button>
              <button type="button" :disabled="action.busy.value" @click="decide(a.id, 'rejected')">
                Reject
              </button>
            </div>
          </template>
          <p v-else class="muted">
            {{ a.decision }}{{ a.decided ? ` ${formatDate(a.decided)}` : ''
            }}{{ a.decisionNote ? `: ${a.decisionNote}` : '' }}
          </p>
        </li>
      </ul>
      <p v-if="applications.data.value.items.length === 0" class="muted">
        No {{ filter }} applications.
      </p>
      <ResultPager
        :total="applications.data.value.total"
        :offset="offset"
        :limit="LIMIT"
        @change="page"
      />
    </template>
    <p v-else-if="applications.pending.value" class="muted">Loading…</p>
  </section>
</template>

<style scoped>
.applications {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.applications li {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem 1rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
</style>
