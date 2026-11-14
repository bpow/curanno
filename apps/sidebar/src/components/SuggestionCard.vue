<script setup lang="ts">
import { toProblem, type Problem } from '@curanno/api-client';
import { computed, ref } from 'vue';
import { withEditor, type AnnotationDraft } from '../api/annotations';
import { currentUserIri } from '../current-user';
import { useGuest } from '../guest';
import { usePostAnnotation } from '../post-annotation';
import { useAnnotationsStore } from '../stores/annotations';
import { useSuggestionsStore, type SuggestionItem } from '../stores/suggestions';
import AnnotationEditor from './AnnotationEditor.vue';
import ProblemAlert from './ProblemAlert.vue';
import StructuredBodyView from './StructuredBodyView.vue';

const props = defineProps<{ item: SuggestionItem }>();

const guest = useGuest();
const store = useAnnotationsStore();
const suggestions = useSuggestionsStore();
const post = usePostAnnotation();

const editing = ref(false);
const busy = ref(false);
const problem = ref<Problem>();

const body = computed(() => ({
  type: 'StructuredBody' as const,
  profile: props.item.profile,
  value: props.item.value,
}));
const draft = computed<AnnotationDraft>(() => ({
  text: '',
  tags: [],
  structured: {
    profile: props.item.profile,
    value: props.item.value,
    creator: props.item.creator,
    created: props.item.created,
  },
}));
const state = computed(() => guest.anchoring.value.get(props.item.id));

async function save(next: AnnotationDraft): Promise<void> {
  const doc = guest.documents.value.find((d) => d.uri === props.item.documentUri);
  if (!doc) {
    problem.value = { status: 0, title: 'The page this suggestion was made on is gone.' };
    return;
  }
  busy.value = true;
  try {
    const structured =
      next.structured &&
      (await withEditor(draft.value.structured, next.structured, currentUserIri));
    const created = await post(
      doc,
      { ...next, ...(structured ? { structured } : {}) },
      props.item.target,
    );
    // The saved annotation is highlighted in its own right from now on.
    suggestions.discard(guest, props.item.id);
    if (next.acl) await store.share(created.annotation.id, next.acl);
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <li
    class="suggestion"
    :aria-label="`Suggestion: ${item.selectors.quote.exact}`"
    @mouseenter="guest.focus([item.id])"
    @mouseleave="guest.focus([])"
  >
    <blockquote class="quote">
      <button type="button" class="link" title="Show in the page" @click="guest.scrollTo(item.id)">
        {{ item.selectors.quote.exact }}
      </button>
    </blockquote>
    <p v-if="state && state !== 'anchored'" class="muted note">
      The page no longer shows this passage as it did.
    </p>
    <template v-if="!editing">
      <StructuredBodyView :body="body" />
      <p v-if="item.unresolvedTerms.length" class="muted note">
        Not matched to an ontology term, kept as written: {{ item.unresolvedTerms.join(', ') }}.
      </p>
      <div class="actions">
        <button type="button" class="primary" @click="editing = true">Review and save</button>
        <button type="button" @click="suggestions.discard(guest, item.id)">Discard</button>
      </div>
    </template>
    <AnnotationEditor
      v-else
      :draft="draft"
      submit-label="Save annotation"
      :busy="busy"
      :problem="problem"
      sharing
      @save="save"
      @cancel="editing = false"
    />
    <ProblemAlert v-if="!editing" :problem="problem" />
  </li>
</template>

<style scoped>
.suggestion {
  list-style: none;
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--accent);
  border-radius: 6px;
  margin-bottom: 0.5rem;
}

.quote {
  margin: 0 0 0.4rem;
  padding: 0.2rem 0.6rem;
  border-left: 3px dashed var(--accent);
  font-style: italic;
  overflow-wrap: anywhere;
}

.quote .link {
  color: var(--text);
  text-align: left;
  font: inherit;
  text-decoration: none;
}

.quote .link:hover {
  text-decoration: underline;
}

.note {
  font-size: 0.85em;
  margin: 0.3rem 0;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.4rem;
}
</style>
