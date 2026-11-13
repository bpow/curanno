<script setup lang="ts">
import {
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
  TagsInputRoot,
} from 'reka-ui';

defineProps<{ modelValue: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>();

const trimmed = (text: string): string => text.trim();

// Text that was only spaces trims to nothing, which is not a tag.
function update(tags: string[]): void {
  emit('update:modelValue', tags.filter(Boolean));
}
</script>

<template>
  <TagsInputRoot
    class="tags"
    :model-value="modelValue"
    :convert-value="trimmed"
    add-on-blur
    add-on-paste
    @update:model-value="update"
  >
    <TagsInputItem v-for="tag in modelValue" :key="tag" :value="tag" class="tag">
      <TagsInputItemText />
      <TagsInputItemDelete class="remove">×</TagsInputItemDelete>
    </TagsInputItem>
    <TagsInputInput name="tag" placeholder="Add tag" aria-label="Add tag" />
  </TagsInputRoot>
</template>

<style scoped>
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}

.tag {
  background: var(--tag-bg);
  color: var(--tag-text);
  border: 1px solid var(--tag-border);
  border-radius: 999px;
  padding: 0 0.3rem 0 0.6rem;
  font-size: 0.9em;
}

.tag[data-state='active'] {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.remove {
  border: 0;
  background: none;
  padding: 0 0.2rem;
  color: inherit;
}

input {
  width: auto;
  flex: 1;
  min-width: 6rem;
}
</style>
