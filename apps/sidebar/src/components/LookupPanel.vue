<script setup lang="ts">
/**
 * Looks a field's text up through the API's resolver (ADR 0039) and offers its
 * candidates. It never fills a field by itself: the curator picks a candidate,
 * or marks the text unresolvable.
 */
import { type components, type Problem, toProblem, unwrap } from '@curanno/api-client';
import { givesIds, type FieldLookup } from '@curanno/model';
import { computed, ref, watch } from 'vue';
import { useApi } from '../api/client';
import ProblemAlert from './ProblemAlert.vue';

type Resolution = components['schemas']['Resolution'];
type Candidate = components['schemas']['ResolutionCandidate'];

const props = defineProps<{
  lookup: FieldLookup;
  /** The text as the article gives it. */
  text: string | undefined;
  /** The resolver's context, from the fields that give it. */
  context: Record<string, string>;
  /** Whether the text is already marked unresolvable. */
  unresolvable: boolean;
  /** For element ids. */
  idPrefix: string;
}>();
const emit = defineEmits<{ use: [candidate: Candidate]; unresolvable: [] }>();

const result = ref<Resolution>();
const problem = ref<Problem>();
const busy = ref(false);

const query = computed(() => props.text?.trim() ?? '');
const contextKey = computed(() => JSON.stringify(props.context));
let revision = 0;

// A result is for the text it was asked about; editing the text or its context drops it.
watch(
  [query, contextKey],
  () => {
    revision++;
    result.value = undefined;
    problem.value = undefined;
  },
  { flush: 'sync' },
);

async function lookUp(): Promise<void> {
  if (!query.value || busy.value) return;
  const requestedRevision = revision;
  busy.value = true;
  result.value = undefined;
  problem.value = undefined;
  try {
    const resolved = unwrap(
      await useApi().GET('/x/resolve/{resolver}', {
        params: {
          path: { resolver: props.lookup.resolver },
          query: { ...props.context, q: query.value },
        },
      }),
    );
    if (revision === requestedRevision) result.value = resolved;
  } catch (err) {
    if (revision === requestedRevision) problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="lookup">
    <div class="actions">
      <button type="button" class="look-up" :disabled="!query || busy" @click="lookUp">
        {{ busy ? 'Looking up…' : 'Look up IDs' }}
      </button>
      <button
        type="button"
        class="link mark-unresolvable"
        :disabled="unresolvable"
        @click="emit('unresolvable')"
      >
        {{ unresolvable ? 'Marked unresolvable' : 'Mark unresolvable' }}
      </button>
    </div>
    <ProblemAlert :problem="problem">
      <span v-if="problem?.status === 404"> Type the IDs by hand.</span>
    </ProblemAlert>
    <div v-if="result" class="result" aria-live="polite">
      <ul v-if="result.warnings.length" class="warnings">
        <li v-for="(w, i) in result.warnings" :key="i" :data-code="w.code">{{ w.message }}</li>
      </ul>
      <p v-if="result.candidates.length === 0" class="muted">
        Nothing found. Correct the text and look it up again, or mark it unresolvable.
      </p>
      <ol class="candidates">
        <li
          v-for="(c, i) in result.candidates"
          :key="i"
          class="candidate"
          :aria-labelledby="`${idPrefix}candidate-${i}`"
        >
          <strong :id="`${idPrefix}candidate-${i}`">{{ c.label }}</strong>
          <dl>
            <template v-for="fact in c.facts" :key="fact.label">
              <dt>{{ fact.label }}</dt>
              <dd>
                <template v-for="(v, j) in fact.values" :key="j">
                  <template v-if="j > 0">, </template>
                  <a v-if="v.url" :href="v.url" target="_blank" rel="noopener">{{ v.text }}</a>
                  <template v-else>{{ v.text }}</template>
                </template>
                <span v-if="fact.values.length === 0" class="muted">none</span>
              </dd>
            </template>
          </dl>
          <ul v-if="c.warnings.length" class="warnings">
            <li v-for="(w, j) in c.warnings" :key="j" :data-code="w.code">{{ w.message }}</li>
          </ul>
          <button
            v-if="givesIds(lookup, c.fill)"
            type="button"
            :aria-describedby="`${idPrefix}candidate-${i}`"
            @click="emit('use', c)"
          >
            Use these IDs
          </button>
          <p v-else class="muted">Nothing to fill in.</p>
        </li>
      </ol>
      <details v-if="result.steps.length" class="steps">
        <summary>What was asked</summary>
        <ol>
          <li v-for="(s, i) in result.steps" :key="i">
            {{ s.service }}: <code>{{ s.request }}</code> — {{ s.outcome }}
          </li>
        </ol>
      </details>
    </div>
  </div>
</template>

<style scoped>
.lookup {
  display: grid;
  gap: 0.4rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.result {
  display: grid;
  gap: 0.4rem;
}

.candidates {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}

.candidate {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  display: grid;
  gap: 0.3rem;
  overflow-wrap: anywhere;
}

.candidate > button {
  justify-self: start;
}

dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.6rem;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

.warnings {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.9em;
}

.steps {
  font-size: 0.85em;
}

.steps ol {
  margin: 0.2rem 0 0;
  padding-left: 1.2rem;
}

p {
  margin: 0;
}
</style>
