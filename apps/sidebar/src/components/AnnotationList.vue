<script setup lang="ts">
import { computed } from 'vue';
import { useGuest } from '../guest';
import { useAnnotationsStore } from '../stores/annotations';
import AnnotationThread from './AnnotationThread.vue';
import ProblemAlert from './ProblemAlert.vue';

const store = useAnnotationsStore();
const guest = useGuest();

/** One group per document with annotations when frames bring several; a flat list otherwise. */
const groups = computed(() => {
  const documents = guest.documents.value;
  if (documents.length < 2) return [{ document: undefined, roots: store.roots }];
  return documents
    .map((document) => ({ document, roots: store.rootsOf(document.uri) }))
    .filter((group) => group.roots.length > 0);
});
</script>

<template>
  <section class="list" aria-label="Annotations" aria-live="polite">
    <ProblemAlert :problem="store.problem" />
    <p v-if="store.loading" class="muted">Loading annotations…</p>
    <p v-else-if="!store.roots.length && !store.problem" class="muted empty">
      No annotations on this document yet.
    </p>
    <template v-for="group in groups" :key="group.document?.uri ?? ''">
      <h2 v-if="group.document" class="document-heading muted" :title="group.document.uri">
        {{ group.document.title ?? group.document.uri }}
      </h2>
      <AnnotationThread v-for="root in group.roots" :key="root.id" :annotation="root" />
    </template>
  </section>
</template>

<style scoped>
.list {
  display: grid;
  gap: 0.5rem;
}

.document-heading {
  font-size: 0.85em;
  font-weight: 600;
  margin: 0.5rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
