<script setup lang="ts">
import { useAnnotationsStore } from '../stores/annotations';
import AnnotationThread from './AnnotationThread.vue';
import ProblemAlert from './ProblemAlert.vue';

const store = useAnnotationsStore();
</script>

<template>
  <section class="list" aria-label="Annotations" aria-live="polite">
    <ProblemAlert :problem="store.problem" />
    <p v-if="store.loading" class="muted">Loading annotations…</p>
    <p v-else-if="!store.roots.length && !store.problem" class="muted empty">
      No annotations on this document yet.
    </p>
    <AnnotationThread v-for="root in store.roots" :key="root.id" :annotation="root" />
  </section>
</template>

<style scoped>
.list {
  display: grid;
  gap: 0.5rem;
}
</style>
