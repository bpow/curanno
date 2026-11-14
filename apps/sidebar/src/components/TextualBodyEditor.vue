<script setup lang="ts">
import TagInput from './TagInput.vue';

defineProps<{ modelValue: string; tags: string[]; placeholder?: string | undefined }>();
const emit = defineEmits<{
  'update:modelValue': [text: string];
  'update:tags': [tags: string[]];
}>();
</script>

<template>
  <div class="textual">
    <textarea
      :value="modelValue"
      name="text"
      :placeholder="placeholder ?? 'Add a comment'"
      aria-label="Comment"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <TagInput
      :model-value="tags"
      name="tag"
      label="Add tag"
      placeholder="Add tag"
      @update:model-value="emit('update:tags', $event)"
    />
  </div>
</template>

<style scoped>
.textual {
  display: grid;
  gap: 0.4rem;
}
</style>
