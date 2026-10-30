<script setup lang="ts">
import type { Annotation } from '@scale/api-client';
import { useAnnotationsStore } from '../stores/annotations';
import AnnotationCard from './AnnotationCard.vue';

defineOptions({ name: 'AnnotationThread' });
defineProps<{ annotation: Annotation; reply?: boolean }>();

const store = useAnnotationsStore();
</script>

<template>
  <div class="thread">
    <AnnotationCard :annotation="annotation" :reply="reply" />
    <div v-if="store.repliesTo(annotation.id).length" class="replies">
      <AnnotationThread
        v-for="child in store.repliesTo(annotation.id)"
        :key="child.id"
        :annotation="child"
        reply
      />
    </div>
  </div>
</template>

<style scoped>
.replies {
  margin-left: 1rem;
  display: grid;
  gap: 0.3rem;
}
</style>
