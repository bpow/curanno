<script setup lang="ts">
import type { OntologyLookup } from '@curanno/model';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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

const pending = ref('');
const suggestions = ref<Suggestion[]>([]);
const active = ref(-1);
const unavailable = ref(false);
const listId = computed(() => `${props.inputId}-suggestions`);
const ontologies = useOntologiesStore();
// The statement HPO's license asks for, with the release, and the same form for any other ontology.
const source = computed(() => ontologies.byName(props.ontology.name));
onMounted(() => void ontologies.ensureLoaded());
const open = computed(() => suggestions.value.length > 0);

let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;
onBeforeUnmount(() => clearTimeout(timer));

function close(): void {
  suggestions.value = [];
  active.value = -1;
}

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
  active.value = -1;
}

function onInput(): void {
  clearTimeout(timer);
  const q = pending.value.trim();
  if (q.length < MIN_QUERY) {
    latest++;
    close();
    return;
  }
  timer = setTimeout(() => void lookup(q), DEBOUNCE_MS);
}

function add(term: Term): void {
  const taken = props.modelValue.some((t) =>
    term.id ? t.id === term.id : !t.id && t.label.toLowerCase() === term.label.toLowerCase(),
  );
  if (!taken) emit('update:modelValue', [...props.modelValue, term]);
  pending.value = '';
  clearTimeout(timer);
  latest++;
  close();
}

function pick(s: Suggestion): void {
  add({ id: s.id, label: s.label });
}

function addText(): void {
  const label = pending.value.trim();
  if (label) add({ label });
  else close();
}

function removeAt(index: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
}

function onKeydown(event: KeyboardEvent): void {
  const n = suggestions.value.length;
  if (event.key === 'ArrowDown' && n) {
    event.preventDefault();
    active.value = (active.value + 1) % n;
  } else if (event.key === 'ArrowUp' && n) {
    event.preventDefault();
    active.value = active.value <= 0 ? n - 1 : active.value - 1;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const s = suggestions.value[active.value];
    if (s) pick(s);
    else addText();
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    close();
  } else if (event.key === 'Backspace' && !pending.value && props.modelValue.length) {
    removeAt(props.modelValue.length - 1);
  }
}
</script>

<template>
  <div class="terms">
    <span
      v-for="(term, i) in modelValue"
      :key="term.id ?? `text:${term.label}`"
      class="term"
      :class="{ text: !term.id }"
      :title="term.id ? undefined : 'Not an ontology term: kept as written'"
    >
      {{ term.label }}<span v-if="term.id" class="id muted"> {{ term.id }}</span>
      <button
        type="button"
        class="remove"
        :aria-label="`Remove ${term.label}`"
        @click="removeAt(i)"
      >
        ×
      </button>
    </span>
    <div class="combo">
      <input
        :id="inputId"
        v-model="pending"
        type="text"
        :name="name"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="active >= 0 ? `${listId}-${active}` : undefined"
        placeholder="Search or type a phenotype"
        @input="onInput"
        @keydown="onKeydown"
        @blur="addText"
      />
      <ul v-show="open" :id="listId" role="listbox" class="suggestions">
        <li
          v-for="(s, i) in suggestions"
          :id="`${listId}-${i}`"
          :key="s.id"
          role="option"
          :aria-selected="i === active"
          :class="{ active: i === active }"
          @mousedown.prevent="pick(s)"
        >
          {{ s.label }} <span class="id muted">{{ s.id }}</span>
          <span v-if="s.synonym" class="synonym muted">matched “{{ s.synonym }}”</span>
        </li>
      </ul>
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
  </div>
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

.remove {
  border: 0;
  background: none;
  padding: 0 0.2rem;
  color: var(--muted);
}

.combo {
  position: relative;
  flex: 1;
  min-width: 10rem;
}

.combo input {
  width: 100%;
}

.suggestions {
  position: absolute;
  z-index: 10;
  left: 0;
  right: 0;
  margin: 0.1rem 0 0;
  padding: 0;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-height: 16rem;
  overflow-y: auto;
}

.suggestions li {
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.suggestions li.active,
.suggestions li:hover {
  background: var(--surface-2);
}

.synonym {
  display: block;
  font-size: 0.85em;
}

.hint {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.85em;
}
</style>
