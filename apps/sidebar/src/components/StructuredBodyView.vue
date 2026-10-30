<script setup lang="ts">
import type { JsonValue, StructuredBody } from '@curanno/model';
import { computed } from 'vue';
import { useProfilesStore } from '../stores/profiles';

const props = defineProps<{ body: StructuredBody }>();
const profiles = useProfilesStore();

const title = computed(() => profiles.byIri(props.body.profile)?.title ?? props.body.profile);
function show(v: JsonValue): string {
  if (Array.isArray(v)) return v.map(show).join(', ');
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

const entries = computed(() => {
  const value = props.body.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [['value', JSON.stringify(value)] as const];
  }
  return Object.entries(value).map(([k, v]) => [k, show(v)] as const);
});
</script>

<template>
  <dl class="structured-view">
    <dt class="profile">{{ title }}</dt>
    <template v-for="[key, text] in entries" :key="key">
      <dt>{{ key }}</dt>
      <dd>{{ text }}</dd>
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

dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
