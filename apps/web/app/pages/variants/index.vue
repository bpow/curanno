<script setup lang="ts">
import { toProblem, unwrap, type Annotation, type Problem } from '@curanno/api-client';
import { caseVariantProfile } from '@curanno/model';
import { computed, onMounted, reactive, ref, shallowRef } from 'vue';
import { NuxtLink } from '#components';
import { definePageMeta } from '#imports';
import { useApi } from '../../api/client';
import ProblemAlert from '../../components/ProblemAlert.vue';
import LookupCandidates from '../../components/LookupCandidates.vue';
import { excerpt } from '../../annotations/view';
import {
  LOOKUP,
  missingVariants,
  needsIds,
  unresolvable,
  updatedInput,
  variantKey,
  withCandidate,
  type Candidate,
  type MissingVariant,
} from '../../variants/missing';
import type { components } from '@curanno/api-client';

/**
 * Case variants still without IDs, grouped by the variant as written, so a
 * curator looks each one up once for every article that reports it (ADR 0039).
 */
definePageMeta({ middleware: 'auth' });

type Resolution = components['schemas']['Resolution'];
type Value = Parameters<typeof needsIds>[0];

const PAGE = 200;
/** Annotations read at most; past this the page says the list is incomplete. */
const MAX = 5000;

const api = useApi();
const annotations = shallowRef<Annotation[]>([]);
const total = ref(0);
const loading = ref(false);
const problem = ref<Problem | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  problem.value = null;
  try {
    const all: Annotation[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const page = unwrap(
        await api.GET('/x/search', {
          params: { query: { profile: caseVariantProfile.iri, limit: PAGE, offset } },
        }),
      );
      all.push(...page.items);
      total.value = page.total;
      if (page.items.length < PAGE || all.length >= page.total) break;
    }
    annotations.value = all;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const groups = computed(() => missingVariants(annotations.value));
const facts = computed(() => groups.value.reduce((n, g) => n + g.facts.length, 0));
const incomplete = computed(() => total.value > annotations.value.length);

/** What a curator is doing with one variant: the gene to look it up with, its result, a save. */
interface Work {
  gene: string;
  revision: number;
  result?: Resolution;
  problem?: Problem;
  busy: boolean;
  outcome?: string;
}
const work = reactive(new Map<string, Work>());
function workFor(group: MissingVariant): Work {
  let w = work.get(group.key);
  if (!w) {
    w = { gene: group.gene ?? '', revision: 0, busy: false };
    work.set(group.key, w);
  }
  return w;
}

function setGene(group: MissingVariant, event: Event): void {
  const w = workFor(group);
  w.gene = (event.target as HTMLInputElement).value;
  w.revision++;
  w.result = undefined;
  w.problem = undefined;
  w.outcome = undefined;
}

async function lookUp(group: MissingVariant): Promise<void> {
  const w = workFor(group);
  if (w.busy) return;
  const requestedRevision = w.revision;
  w.busy = true;
  w.result = undefined;
  w.problem = undefined;
  w.outcome = undefined;
  try {
    const gene = w.gene.trim();
    const result = unwrap(
      await api.GET('/x/resolve/{resolver}', {
        params: {
          path: { resolver: LOOKUP.resolver },
          query: { q: group.variant, ...(gene ? { gene } : {}) },
        },
      }),
    );
    if (w.revision === requestedRevision) w.result = result;
  } catch (err) {
    if (w.revision === requestedRevision) w.problem = toProblem(err);
  } finally {
    w.busy = false;
  }
}

/**
 * Saves the change to every fact of the group the caller may edit. Each is read again for its
 * ETag; one whose variant or gene changed, or that gained IDs, is left as it is.
 */
async function apply(group: MissingVariant, change: (value: Value) => Value): Promise<void> {
  const w = workFor(group);
  w.busy = true;
  w.problem = undefined;
  let saved = 0;
  let skipped = 0;
  const failed: string[] = [];
  // What the server has now for each fact read or saved, so the list need not be read again.
  const fresh = new Map<string, Annotation>();
  for (const fact of group.facts) {
    if (!fact.writable) {
      skipped++;
      continue;
    }
    try {
      const current = await api.GET('/annotations/{id}', { params: { path: { id: fact.uuid } } });
      const annotation = unwrap(current);
      fresh.set(annotation.id, annotation);
      const etag = current.response.headers.get('etag');
      let eligible = false;
      const input = updatedInput(annotation, (value) => {
        eligible = needsIds(value) && variantKey(value) === group.key;
        return eligible ? change(value) : value;
      });
      if (!input || !eligible || !etag) {
        skipped++;
        continue;
      }
      const updated = unwrap(
        await api.PUT('/annotations/{id}', {
          params: { path: { id: fact.uuid }, header: { 'If-Match': etag } },
          body: input as never,
        }),
      );
      fresh.set(updated.id, updated);
      saved++;
    } catch (err) {
      failed.push(`${fact.source}: ${toProblem(err).title}`);
    }
  }
  w.busy = false;
  const parts = [`${saved} saved`];
  if (skipped) parts.push(`${skipped} left as they were (not yours to edit, or changed since)`);
  if (failed.length) parts.push(`${failed.length} failed: ${failed.join('; ')}`);
  const outcome = parts.join(', ');
  annotations.value = annotations.value.map((a) => fresh.get(a.id) ?? a);
  // The group is gone from the list once every fact has IDs; keep the outcome on what remains.
  const remaining = groups.value.find((g) => g.key === group.key);
  if (remaining) workFor(remaining).outcome = outcome;
  else lastOutcome.value = `${group.variant}: ${outcome}.`;
}

const lastOutcome = ref<string>();

const use = (group: MissingVariant, candidate: Candidate) =>
  apply(group, (value) => withCandidate(value, candidate));
const markUnresolvable = (group: MissingVariant) => apply(group, unresolvable);

const documents = (group: MissingVariant) => new Set(group.facts.map((f) => f.source)).size;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
</script>

<template>
  <section>
    <h1>Variants without IDs</h1>
    <p class="muted">
      Case-variant annotations you can read that have no CAID or ClinVar ID and are not marked
      unresolvable, grouped by the variant as written. Look a variant up once and save its IDs to
      every annotation that reports it.
    </p>
    <ProblemAlert :problem="problem" />
    <p v-if="lastOutcome" role="status">{{ lastOutcome }}</p>
    <p v-if="incomplete" class="muted">
      Only the first {{ annotations.length }} of {{ total }} case-variant annotations were read.
    </p>
    <p v-if="loading && annotations.length === 0" class="muted">Loading…</p>
    <template v-else-if="!problem">
      <p class="muted">
        {{ plural(groups.length, 'variant') }} in {{ plural(facts, 'annotation') }}.
      </p>
      <p v-if="groups.length === 0" class="muted">Every case variant has its IDs.</p>
      <article
        v-for="(group, i) in groups"
        :key="group.key"
        class="variant"
        :aria-labelledby="`variant-${i}`"
      >
        <header>
          <h2 :id="`variant-${i}`">
            <code>{{ group.variant }}</code>
            <span v-if="group.gene" class="muted"> in {{ group.gene }}</span>
          </h2>
          <p class="muted">
            {{ plural(group.facts.length, 'annotation') }} on
            {{ plural(documents(group), 'document') }}
          </p>
        </header>
        <details>
          <summary>Annotations</summary>
          <ul class="facts">
            <li v-for="fact in group.facts" :key="fact.iri">
              <a :href="fact.source" target="_blank" rel="noopener">{{ fact.source }}</a>
              <span v-if="fact.quote" class="muted"> — “{{ excerpt(fact.quote, 120) }}”</span>
              <NuxtLink :to="`/browse/${fact.uuid}`">Open</NuxtLink>
              <span v-if="!fact.writable" class="muted"> (read only)</span>
            </li>
          </ul>
        </details>
        <form class="inline" @submit.prevent="lookUp(group)">
          <label class="field">
            Gene
            <input
              :value="workFor(group).gene"
              name="gene"
              size="10"
              placeholder="HGNC symbol"
              :aria-describedby="`gene-hint-${i}`"
              @input="setGene(group, $event)"
            />
          </label>
          <button type="submit" :disabled="workFor(group).busy">
            {{ workFor(group).busy ? 'Working…' : 'Look up IDs' }}
          </button>
          <button
            type="button"
            class="link"
            :disabled="workFor(group).busy"
            @click="markUnresolvable(group)"
          >
            Mark unresolvable
          </button>
        </form>
        <p :id="`gene-hint-${i}`" class="muted hint">
          Needed for a change given without a transcript, or a protein change on its own.
        </p>
        <ProblemAlert :problem="workFor(group).problem ?? null" />
        <p v-if="workFor(group).outcome" role="status">{{ workFor(group).outcome }}</p>
        <LookupCandidates
          v-if="workFor(group).result"
          :lookup="LOOKUP"
          :result="workFor(group).result!"
          :busy="workFor(group).busy"
          :action="`Use for ${plural(group.facts.filter((f) => f.writable).length, 'annotation')}`"
          @use="use(group, $event)"
        />
      </article>
    </template>
  </section>
</template>

<style scoped>
.variant {
  border-top: 1px solid var(--border);
  padding: 0.75rem 0;
  display: grid;
  gap: 0.5rem;
}

.variant header h2 {
  font-size: 1.05rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.variant header p,
.hint {
  margin: 0;
}

.hint {
  font-size: 0.9em;
}

.facts {
  margin: 0.3rem 0 0;
  padding-left: 1.2rem;
  overflow-wrap: anywhere;
}

.facts a {
  margin-right: 0.4rem;
}
</style>
