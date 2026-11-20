<script setup lang="ts">
import type { components } from '@curanno/api-client';
import {
  idFieldsOf,
  linkedIris,
  lookupContext,
  withLookedUp,
  withUnresolvable,
  type FieldLookup,
  type JsonValue,
  type ValidationError,
} from '@curanno/model';
import { computed, inject } from 'vue';
import {
  EXTRA_LINKS,
  extraCandidates,
  linkCandidates,
  type LinkCandidate,
} from '../profiles/links';
import type { SchemaField, Term } from '../profiles/schema';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import LinkInput from './LinkInput.vue';
import TagInput from './TagInput.vue';
import TermListInput from './TermListInput.vue';
import LookupPanel from './LookupPanel.vue';

type Candidate = components['schemas']['ResolutionCandidate'];

const props = defineProps<{
  fields: SchemaField[];
  modelValue: JsonValue | undefined;
  /** Instance path of this object, for matching validation errors (`/value`). */
  path: string;
  /** Prefix for element ids and names; empty at the top level. */
  idPrefix: string;
  errors?: ValidationError[] | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, JsonValue>] }>();

const value = computed<Record<string, JsonValue>>(() =>
  typeof props.modelValue === 'object' &&
  props.modelValue !== null &&
  !Array.isArray(props.modelValue)
    ? props.modelValue
    : {},
);

const fieldPath = (field: SchemaField) => `${props.path}/${field.name}`;
const nameOf = (field: SchemaField) => `${props.idPrefix}${field.name}`;
const under = (e: ValidationError, path: string) =>
  e.instancePath === path || e.instancePath.startsWith(path + '/');

// An object list shows only errors about the list itself; its items show their own.
function errorsFor(field: SchemaField): string[] {
  const path = fieldPath(field);
  return (props.errors ?? [])
    .filter((e) => (field.kind === 'object-list' ? e.instancePath === path : under(e, path)))
    .map((e) => e.message);
}

function itemErrors(field: SchemaField, index: number): ValidationError[] {
  const path = `${fieldPath(field)}/${index}`;
  return (props.errors ?? []).filter((e) => under(e, path));
}

const generalErrors = computed(() =>
  (props.errors ?? [])
    .filter((e) => !props.fields.some((f) => under(e, fieldPath(f))))
    .map((e) => e.message),
);

function set(name: string, next: JsonValue | undefined): void {
  const copy: Record<string, JsonValue> = { ...value.value };
  if (next === undefined || next === '') delete copy[name];
  else copy[name] = next;
  keepIdSourceTrue(copy, name);
  emit('update:modelValue', copy);
}

// Looked-up IDs belong to the text and context they were looked up for. Changing
// either, or typing an ID, also makes an unresolvable marker obsolete.
function keepIdSourceTrue(copy: Record<string, JsonValue>, edited: string): void {
  for (const field of props.fields) {
    const source = field.lookup?.source;
    if (!field.lookup || !source) continue;
    const queryChanged =
      edited === field.name || Object.values(field.lookup.context ?? {}).includes(edited);
    if (queryChanged && copy[source] === 'looked up') {
      for (const name of [...Object.values(field.lookup.fill), source]) delete copy[name];
    } else if (
      copy[source] === 'unresolvable' &&
      (queryChanged || idFieldsOf(field.lookup).includes(edited))
    ) {
      delete copy[source];
    }
  }
}

function text(name: string): string | undefined {
  const current = value.value[name];
  return typeof current === 'string' ? current : undefined;
}

function isUnresolvable(lookup: FieldLookup): boolean {
  return !!lookup.source && value.value[lookup.source] === 'unresolvable';
}

function useCandidate(lookup: FieldLookup, candidate: Candidate): void {
  emit('update:modelValue', withLookedUp(value.value, lookup, candidate.fill));
}

function markUnresolvable(lookup: FieldLookup): void {
  emit('update:modelValue', withUnresolvable(value.value, lookup));
}

function strings(name: string): string[] {
  const current = value.value[name];
  return Array.isArray(current) ? current.map(String) : [];
}

function setStrings(name: string, list: string[]): void {
  set(name, list.length ? list : undefined);
}

function setNumber(name: string, text: string): void {
  set(name, text === '' ? undefined : Number(text));
}

function terms(name: string): Term[] {
  const current = value.value[name];
  if (!Array.isArray(current)) return [];
  return current.flatMap((t) => {
    if (typeof t !== 'object' || t === null || Array.isArray(t)) return [];
    const { id, label } = t;
    if (typeof label !== 'string') return [];
    return [typeof id === 'string' ? { id, label } : { label }];
  });
}

function setTerms(name: string, list: Term[]): void {
  const json = list.map((t) => (t.id ? { id: t.id, label: t.label } : { label: t.label }));
  set(name, json.length ? json : undefined);
}

// The store is only needed, and only touched, when a profile has a link field.
const linkable = computed(() =>
  props.fields.some((f) => f.kind === 'annotation') ? useAnnotationsStore().all : [],
);

const extras = inject(EXTRA_LINKS, undefined);

function candidates(field: SchemaField): LinkCandidate[] {
  if (!field.link) return [];
  return [
    ...linkCandidates(linkable.value, field.link),
    ...extraCandidates(extras?.value ?? [], field.link),
  ];
}

function links(field: SchemaField): string[] {
  return linkedIris(value.value[field.name]);
}

function setLinks(field: SchemaField, ids: string[]): void {
  set(field.name, field.multiple ? (ids.length ? ids : undefined) : ids[0]);
}

const nounOf = (field: SchemaField): string =>
  (field.link && useProfilesStore().byIri(field.link.profile)?.title.toLowerCase()) ?? 'annotation';

function items(name: string): JsonValue[] {
  const current = value.value[name];
  return Array.isArray(current) ? current : [];
}

function setItem(name: string, index: number, item: JsonValue): void {
  const list = [...items(name)];
  list[index] = item;
  set(name, list);
}

function addItem(name: string): void {
  set(name, [...items(name), {}]);
}

function removeItem(name: string, index: number): void {
  const list = items(name).filter((_, i) => i !== index);
  set(name, list.length ? list : undefined);
}
</script>

<template>
  <div v-for="field in fields" :key="field.name" class="field">
    <fieldset v-if="field.kind === 'object-list'" class="list">
      <legend>{{ field.title }}<span v-if="field.required" aria-hidden="true"> *</span></legend>
      <p v-if="field.description" class="hint muted">{{ field.description }}</p>
      <fieldset v-for="(item, i) in items(field.name)" :key="i" class="item">
        <legend>{{ field.itemTitle }} {{ i + 1 }}</legend>
        <SchemaFields
          :fields="field.fields ?? []"
          :model-value="item"
          :path="`${fieldPath(field)}/${i}`"
          :id-prefix="`${nameOf(field)}.${i}.`"
          :errors="itemErrors(field, i)"
          @update:model-value="setItem(field.name, i, $event)"
        />
        <button type="button" class="link" @click="removeItem(field.name, i)">
          Remove {{ field.itemTitle }} {{ i + 1 }}
        </button>
      </fieldset>
      <button type="button" @click="addItem(field.name)">Add {{ field.itemTitle }}</button>
      <p v-for="(message, i) in errorsFor(field)" :key="i" class="error" role="alert">
        {{ message }}
      </p>
    </fieldset>
    <template v-else>
      <label :for="`field-${nameOf(field)}`">
        {{ field.title }}<span v-if="field.required" aria-hidden="true"> *</span>
      </label>
      <LinkInput
        v-if="field.kind === 'annotation'"
        :input-id="`field-${nameOf(field)}`"
        :name="nameOf(field)"
        :required="field.required"
        :multiple="field.multiple ?? false"
        :noun="nounOf(field)"
        :candidates="candidates(field)"
        :model-value="links(field)"
        @update:model-value="setLinks(field, $event)"
      />
      <select
        v-else-if="field.kind === 'select'"
        :id="`field-${nameOf(field)}`"
        :name="nameOf(field)"
        :required="field.required"
        :value="value[field.name] ?? ''"
        @change="set(field.name, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">—</option>
        <option v-for="option in field.options" :key="option" :value="option">
          {{ option }}
        </option>
      </select>
      <input
        v-else-if="field.kind === 'boolean'"
        :id="`field-${nameOf(field)}`"
        type="checkbox"
        :name="nameOf(field)"
        :checked="value[field.name] === true"
        @change="set(field.name, ($event.target as HTMLInputElement).checked)"
      />
      <input
        v-else-if="field.kind === 'number'"
        :id="`field-${nameOf(field)}`"
        type="number"
        :name="nameOf(field)"
        :required="field.required"
        :value="value[field.name] ?? ''"
        @input="setNumber(field.name, ($event.target as HTMLInputElement).value)"
      />
      <TermListInput
        v-else-if="field.kind === 'term-list' && field.ontology"
        :input-id="`field-${nameOf(field)}`"
        :name="nameOf(field)"
        :ontology="field.ontology"
        :model-value="terms(field.name)"
        @update:model-value="setTerms(field.name, $event)"
      />
      <TagInput
        v-else-if="field.kind === 'string-list'"
        :input-id="`field-${nameOf(field)}`"
        :name="nameOf(field)"
        :required="field.required"
        :model-value="strings(field.name)"
        @update:model-value="setStrings(field.name, $event)"
      />
      <textarea
        v-else-if="field.kind === 'textarea'"
        :id="`field-${nameOf(field)}`"
        :name="nameOf(field)"
        :required="field.required"
        :value="(value[field.name] as string | undefined) ?? ''"
        @input="set(field.name, ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <input
        v-else
        :id="`field-${nameOf(field)}`"
        type="text"
        :name="nameOf(field)"
        :required="field.required"
        :value="(value[field.name] as string | undefined) ?? ''"
        @input="set(field.name, ($event.target as HTMLInputElement).value)"
      />
      <p v-if="field.description" class="hint muted">{{ field.description }}</p>
      <p v-for="(message, i) in errorsFor(field)" :key="i" class="error" role="alert">
        {{ message }}
      </p>
      <LookupPanel
        v-if="field.lookup"
        :lookup="field.lookup"
        :text="text(field.name)"
        :context="lookupContext(value, field.lookup)"
        :unresolvable="isUnresolvable(field.lookup)"
        :id-prefix="`field-${nameOf(field)}-`"
        @use="useCandidate(field.lookup, $event)"
        @unresolvable="markUnresolvable(field.lookup)"
      />
    </template>
  </div>
  <p v-for="(message, i) in generalErrors" :key="i" class="error" role="alert">{{ message }}</p>
</template>

<style scoped>
.field {
  display: grid;
  gap: 0.2rem;
}

.list,
.item {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  display: grid;
  gap: 0.5rem;
}

.list > button,
.item > button {
  justify-self: start;
}

.hint {
  margin: 0;
  font-size: 0.85em;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.9em;
}

input[type='checkbox'] {
  width: auto;
  justify-self: start;
}
</style>
