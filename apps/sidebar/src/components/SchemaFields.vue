<script setup lang="ts">
import type { JsonValue, ValidationError } from '@curanno/model';
import { computed } from 'vue';
import type { SchemaField } from '../profiles/schema';

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
  emit('update:modelValue', copy);
}

function setList(name: string, text: string): void {
  const list = text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  set(name, list.length ? list : undefined);
}

function listText(name: string): string {
  const current = value.value[name];
  return Array.isArray(current) ? current.map(String).join(', ') : '';
}

function setNumber(name: string, text: string): void {
  set(name, text === '' ? undefined : Number(text));
}

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
      <select
        v-if="field.kind === 'select'"
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
      <input
        v-else-if="field.kind === 'string-list'"
        :id="`field-${nameOf(field)}`"
        type="text"
        :name="nameOf(field)"
        :required="field.required"
        placeholder="Comma-separated"
        :value="listText(field.name)"
        @change="setList(field.name, ($event.target as HTMLInputElement).value)"
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
