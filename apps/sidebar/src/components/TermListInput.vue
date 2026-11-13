<script setup lang="ts">
import type { OntologyLookup } from '@curanno/model';
import {
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteRoot,
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
  TagsInputRoot,
} from 'reka-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useApi } from '../api/client';
import type { Term } from '../profiles/schema';
import { useOntologiesStore } from '../stores/ontologies';

interface Suggestion {
  id: string;
  label: string;
  synonym?: string;
}

const props = defineProps<{
  modelValue: Term[];
  ontology: OntologyLookup;
  inputId: string;
  name: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [terms: Term[]] }>();

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

/** The text in the input. */
const pending = ref('');
const suggestions = ref<Suggestion[]>([]);
const unavailable = ref(false);
/** Whether the list would show if it had anything in it: typing opens it, Escape and a pick close it. */
const wanted = ref(false);
const open = computed(() => wanted.value && suggestions.value.length > 0);
/** Reka keeps naming the last highlighted option after the list closes and it is gone. */
const closedList = computed(() => (open.value ? {} : { 'aria-activedescendant': undefined }));
/** What the list's root exposes for this: its first item becomes the highlighted one. */
const root = useTemplateRef<{ highlightFirstItem?: () => void }>('root');
const ontologies = useOntologiesStore();
// The statement HPO's license asks for, with the release, and the same form for any other ontology.
const source = computed(() => ontologies.byName(props.ontology.name));
onMounted(() => void ontologies.ensureLoaded());

let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;
onBeforeUnmount(() => clearTimeout(timer));

async function lookup(q: string): Promise<void> {
  const request = ++latest;
  try {
    const { data, response } = await useApi().GET('/x/ontologies/{name}/terms', {
      params: {
        path: { name: props.ontology.name },
        query: { q, limit: 10, ...(props.ontology.root ? { root: props.ontology.root } : {}) },
      },
    });
    if (request !== latest) return;
    unavailable.value = !response.ok;
    suggestions.value = data ?? [];
  } catch {
    if (request !== latest) return;
    unavailable.value = true;
    suggestions.value = [];
  }
  // Enter takes the first suggestion unless another is chosen, whichever list just arrived.
  await nextTick();
  root.value?.highlightFirstItem?.();
}

watch(pending, (text) => {
  clearTimeout(timer);
  const q = text.trim();
  if (q.length < MIN_QUERY) {
    latest++;
    suggestions.value = [];
    return;
  }
  timer = setTimeout(() => void lookup(q), DEBOUNCE_MS);
});

/** The list without repeats: a term once per ID, text once whatever its case, nothing empty. */
function unique(terms: Term[]): Term[] {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.id ? `id:${term.id}` : `text:${term.label.toLowerCase()}`;
    if (!term.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function update(terms: Term[]): void {
  emit('update:modelValue', unique(terms));
}

/** Typed text that is kept as written: Enter with no suggestion highlighted, or leaving the field. */
const asText = (text: string): Term => ({ label: text.trim() });
const labelOf = (term: Term): string => term.label;

function reset(): void {
  pending.value = '';
  wanted.value = false;
}

function pick(event: Event, s: Suggestion): void {
  // The choice becomes a term in the list; the input is not filled with it.
  event.preventDefault();
  update([...props.modelValue, { id: s.id, label: s.label }]);
  reset();
  document.getElementById(props.inputId)?.focus();
}
</script>

<template>
  <!-- The list is beside the tags, not inside them: each keeps a collection of its own items. -->
  <AutocompleteRoot
    ref="root"
    v-model="pending"
    :open="open"
    ignore-filter
    @update:open="wanted = $event"
  >
    <div class="anchor">
      <TagsInputRoot
        :id="inputId"
        class="terms"
        :model-value="modelValue"
        :convert-value="asText"
        :display-value="labelOf"
        delimiter=""
        add-on-blur
        @update:model-value="update"
        @add-tag="reset"
      >
        <TagsInputItem
          v-for="term in modelValue"
          :key="term.id ?? `text:${term.label}`"
          :value="term"
          class="term"
          :class="{ text: !term.id }"
          :title="term.id ? undefined : 'Not an ontology term: kept as written'"
        >
          <TagsInputItemText />
          <span v-if="term.id" class="id muted">{{ term.id }}</span>
          <TagsInputItemDelete class="remove">×</TagsInputItemDelete>
        </TagsInputItem>
        <AutocompleteInput as-child>
          <TagsInputInput
            :name="name"
            placeholder="Search or type a phenotype"
            v-bind="closedList"
          />
        </AutocompleteInput>
      </TagsInputRoot>
      <AutocompleteContent class="suggestions">
        <AutocompleteItem
          v-for="s in suggestions"
          :key="s.id"
          :value="s.id"
          :text-value="s.label"
          class="suggestion"
          @select="pick($event, s)"
        >
          {{ s.label }} <span class="id muted">{{ s.id }}</span>
          <span v-if="s.synonym" class="synonym muted">matched “{{ s.synonym }}”</span>
        </AutocompleteItem>
      </AutocompleteContent>
    </div>
    <p v-if="unavailable" class="hint muted">
      Term lookup is unavailable; entries are kept as written.
    </p>
    <p v-else-if="source" class="hint muted attribution">
      This service uses the {{ source.title
      }}<template v-if="source.version"> (version {{ source.version }})</template>.
      <template v-if="source.homepage">
        Find out more at
        <a :href="source.homepage" target="_blank" rel="noopener">{{ source.homepage }}</a>
      </template>
    </p>
  </AutocompleteRoot>
</template>

<style scoped>
.terms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}

.term {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 0.3rem 0 0.6rem;
  font-size: 0.9em;
}

.term.text {
  border-style: dashed;
  font-style: italic;
}

.id {
  font-size: 0.85em;
}

.term .id {
  margin-inline-start: 0.3em;
}

.remove {
  border: 0;
  background: none;
  padding: 0 0.2rem;
  color: var(--muted);
}

.anchor {
  position: relative;
}

.terms input {
  width: auto;
  flex: 1;
  min-width: 10rem;
}

.term[data-state='active'] {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.anchor :deep(.suggestions) {
  position: absolute;
  z-index: 10;
  top: 100%;
  left: 0;
  right: 0;
  margin: 0.1rem 0 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-height: 16rem;
  overflow-y: auto;
}

.anchor :deep(.suggestion) {
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.anchor :deep(.suggestion[data-highlighted]) {
  background: var(--surface-2);
}

.synonym {
  display: block;
  font-size: 0.85em;
}

.hint {
  margin: 0.3rem 0 0;
  font-size: 0.85em;
}
</style>
