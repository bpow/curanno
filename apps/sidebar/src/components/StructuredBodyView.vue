<script setup lang="ts">
import type { JsonValue, StructuredBody } from '@curanno/model';
import { computed } from 'vue';
import { fieldsOf, type SchemaField } from '../profiles/schema';
import { useProfilesStore } from '../stores/profiles';

const props = defineProps<{ body: StructuredBody }>();
const profiles = useProfilesStore();

const profile = computed(() => profiles.byIri(props.body.profile));
const title = computed(() => profile.value?.title ?? props.body.profile);

function show(v: JsonValue): string {
  if (Array.isArray(v)) return v.map(show).join(', ');
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

interface Entry {
  key: string;
  label: string;
  text?: string;
  items?: Entry[][];
}

function isObject(v: JsonValue | undefined): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Labels come from the schema's titles; keys it doesn't describe keep their names.
// Only one level of object lists is laid out; deeper ones are shown as JSON.
function entriesOf(
  value: Record<string, JsonValue>,
  fields: SchemaField[],
  nested = false,
): Entry[] {
  return Object.entries(value).map(([key, v]) => {
    const field = fields.find((f) => f.name === key);
    const label = field?.title ?? key;
    if (!nested && field?.kind === 'object-list' && Array.isArray(v) && v.every(isObject)) {
      return { key, label, items: v.map((item) => entriesOf(item, field.fields ?? [], true)) };
    }
    return { key, label, text: show(v) };
  });
}

const entries = computed<Entry[]>(() => {
  const value = props.body.value;
  if (!isObject(value)) return [{ key: 'value', label: 'value', text: JSON.stringify(value) }];
  return entriesOf(value, profile.value ? fieldsOf(profile.value.schema) : []);
});
</script>

<template>
  <dl class="structured-view">
    <dt class="profile">{{ title }}</dt>
    <template v-for="entry in entries" :key="entry.key">
      <dt>{{ entry.label }}</dt>
      <dd v-if="entry.items">
        <dl v-for="(item, i) in entry.items" :key="i" class="structured-view item">
          <template v-for="sub in item" :key="sub.key">
            <dt>{{ sub.label }}</dt>
            <dd>{{ sub.text }}</dd>
          </template>
        </dl>
      </dd>
      <dd v-else>{{ entry.text }}</dd>
    </template>
  </dl>
</template>

<style scoped>
.structured-view {
  margin: 0.3rem 0;
  padding: 0.3rem 0.6rem;
  border-left: 3px solid var(--accent);
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.6rem;
  font-size: 0.95em;
}

.profile {
  grid-column: 1 / -1;
  font-weight: 600;
}

.item {
  margin: 0 0 0.2rem;
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
