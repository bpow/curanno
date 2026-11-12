<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ modelValue: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>();

const pending = ref('');

function add(): void {
  const tags = pending.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !props.modelValue.includes(t));
  if (tags.length) emit('update:modelValue', [...props.modelValue, ...tags]);
  pending.value = '';
}

function removeAt(index: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    add();
  } else if (event.key === 'Backspace' && !pending.value && props.modelValue.length) {
    removeAt(props.modelValue.length - 1);
  }
}
</script>

<template>
  <div class="tags">
    <span v-for="(tag, i) in modelValue" :key="tag" class="tag">
      {{ tag }}
      <button type="button" class="remove" :aria-label="`Remove tag ${tag}`" @click="removeAt(i)">
        ×
      </button>
    </span>
    <input
      v-model="pending"
      type="text"
      name="tag"
      placeholder="Add tag"
      aria-label="Add tag"
      @keydown="onKeydown"
      @blur="add"
    />
  </div>
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
