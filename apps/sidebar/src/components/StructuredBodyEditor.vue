<script setup lang="ts">
import type { BodyProfile, JsonValue, ValidationError } from '@scale/model';
import { computed } from 'vue';
import { fieldsOf, type SchemaField } from '../profiles/schema';

const props = defineProps<{
  profile: BodyProfile;
  modelValue: JsonValue;
  errors?: ValidationError[] | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: JsonValue] }>();

const fields = computed(() => fieldsOf(props.profile.schema));
const value = computed<Record<string, JsonValue>>(() =>
  typeof props.modelValue === 'object' &&
  props.modelValue !== null &&
  !Array.isArray(props.modelValue)
    ? props.modelValue
    : {},
);

function errorsFor(field: SchemaField): string[] {
  const prefix = `/value/${field.name}`;
  return (props.errors ?? [])
    .filter((e) => e.instancePath === prefix || e.instancePath.startsWith(prefix + '/'))
    .map((e) => e.message);
}

const generalErrors = computed(() =>
  (props.errors ?? [])
    .filter((e) => !fields.value.some((f) => e.instancePath.startsWith(`/value/${f.name}`)))
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
</script>

<template>
  <fieldset class="structured">
    <legend>{{ profile.title }}</legend>
    <p v-if="profile.description" class="muted">{{ profile.description }}</p>
    <div v-for="field in fields" :key="field.name" class="field">
      <label :for="`field-${field.name}`">
        {{ field.title }}<span v-if="field.required" aria-hidden="true"> *</span>
      </label>
      <select
        v-if="field.kind === 'select'"
        :id="`field-${field.name}`"
        :name="field.name"
        :required="field.required"
        :value="value[field.name] ?? ''"
        @change="set(field.name, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">—</option>
        <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
      </select>
      <input
        v-else-if="field.kind === 'boolean'"
        :id="`field-${field.name}`"
        type="checkbox"
        :name="field.name"
        :checked="value[field.name] === true"
        @change="set(field.name, ($event.target as HTMLInputElement).checked)"
      />
      <input
        v-else-if="field.kind === 'number'"
        :id="`field-${field.name}`"
        type="number"
        :name="field.name"
        :required="field.required"
        :value="value[field.name] ?? ''"
        @input="setNumber(field.name, ($event.target as HTMLInputElement).value)"
      />
      <input
        v-else-if="field.kind === 'string-list'"
        :id="`field-${field.name}`"
        type="text"
        :name="field.name"
        :required="field.required"
        placeholder="Comma-separated"
        :value="listText(field.name)"
        @change="setList(field.name, ($event.target as HTMLInputElement).value)"
      />
      <textarea
        v-else-if="field.kind === 'textarea'"
        :id="`field-${field.name}`"
        :name="field.name"
        :required="field.required"
        :value="(value[field.name] as string | undefined) ?? ''"
        @input="set(field.name, ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <input
        v-else
        :id="`field-${field.name}`"
        type="text"
        :name="field.name"
        :required="field.required"
        :value="(value[field.name] as string | undefined) ?? ''"
        @input="set(field.name, ($event.target as HTMLInputElement).value)"
      />
      <p v-if="field.description" class="hint muted">{{ field.description }}</p>
      <p v-for="(message, i) in errorsFor(field)" :key="i" class="error" role="alert">
        {{ message }}
      </p>
    </div>
    <p v-for="(message, i) in generalErrors" :key="i" class="error" role="alert">{{ message }}</p>
  </fieldset>
</template>

<style scoped>
.structured {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  display: grid;
  gap: 0.5rem;
}

legend {
  font-weight: 600;
}

.field {
  display: grid;
  gap: 0.2rem;
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
