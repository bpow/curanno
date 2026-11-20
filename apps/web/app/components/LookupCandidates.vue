<script setup lang="ts">
import type { components } from '@curanno/api-client';
import { givesIds, type FieldLookup } from '@curanno/model';

type Resolution = components['schemas']['Resolution'];
type Candidate = components['schemas']['ResolutionCandidate'];

/** What a lookup found for one mention (ADR 0039). The curator picks. */
defineProps<{ lookup: FieldLookup; result: Resolution; action: string; busy: boolean }>();
const emit = defineEmits<{ use: [candidate: Candidate] }>();
</script>

<template>
  <div class="lookup">
    <ul v-if="result.warnings.length" class="warnings">
      <li v-for="(w, i) in result.warnings" :key="i" :data-code="w.code">{{ w.message }}</li>
    </ul>
    <p v-if="result.candidates.length === 0" class="muted">
      Nothing found. Mark it unresolvable, or correct it in the annotations.
    </p>
    <ol class="candidates">
      <li v-for="(c, i) in result.candidates" :key="i" class="candidate">
        <strong>{{ c.label }}</strong>
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
        <div v-if="givesIds(lookup, c.fill)">
          <button type="button" :disabled="busy" @click="emit('use', c)">{{ action }}</button>
        </div>
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
</template>

<style scoped>
.lookup,
.candidate {
  display: grid;
  gap: 0.4rem;
}

.candidates {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.candidate {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  overflow-wrap: anywhere;
}

dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.75rem;
}

dt {
  color: var(--muted);
}

dd,
p {
  margin: 0;
}

.warnings {
  margin: 0;
  padding-left: 1.2rem;
}

.steps {
  font-size: 0.9em;
}
</style>
