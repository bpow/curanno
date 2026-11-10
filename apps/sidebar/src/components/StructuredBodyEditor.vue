<script setup lang="ts">
import type { BodyProfile, JsonValue, ValidationError } from '@curanno/model';
import { computed } from 'vue';
import { fieldsOf } from '../profiles/schema';
import SchemaFields from './SchemaFields.vue';

const props = defineProps<{
  profile: BodyProfile;
  modelValue: JsonValue;
  errors?: ValidationError[] | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: JsonValue] }>();

const fields = computed(() => fieldsOf(props.profile.schema));
</script>

<template>
  <fieldset class="structured">
    <legend>{{ profile.title }}</legend>
    <p v-if="profile.description" class="muted">{{ profile.description }}</p>
    <SchemaFields
      :fields="fields"
      :model-value="modelValue"
      path="/value"
      id-prefix=""
      :errors="errors"
      @update:model-value="emit('update:modelValue', $event)"
    />
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
</style>
