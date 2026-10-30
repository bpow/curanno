<script setup lang="ts">
import type { Annotation } from '@curanno/api-client';
import { computed } from 'vue';
import { NuxtLink } from '#components';
import {
  anchoringOf,
  annotationUuid,
  commentOf,
  creatorOf,
  documentOf,
  excerpt,
  motivationsOf,
  parentOf,
  quoteOf,
  structuredBodies,
  tagsOf,
} from '../annotations/view';
import { formatDate } from '../util/time';

const props = defineProps<{ annotation: Annotation; link?: boolean }>();

const id = computed(() => annotationUuid(props.annotation.id));
const creator = computed(() => creatorOf(props.annotation));
const document = computed(() => documentOf(props.annotation));
const parent = computed(() => parentOf(props.annotation));
const quote = computed(() => quoteOf(props.annotation));
const comment = computed(() => commentOf(props.annotation));
const tags = computed(() => tagsOf(props.annotation));
const motivations = computed(() => motivationsOf(props.annotation));
const anchoring = computed(() => anchoringOf(props.annotation));
const structured = computed(() => structuredBodies(props.annotation).length);
</script>

<template>
  <article class="card annotation">
    <header class="annotation-head">
      <NuxtLink v-if="creator.userId" :to="`/users/${creator.userId}`">{{ creator.name }}</NuxtLink>
      <span v-else>{{ creator.name }}</span>
      <span class="muted">{{ formatDate(annotation.created) }}</span>
      <span v-for="m in motivations" :key="m" class="badge">{{ m }}</span>
      <span v-if="anchoring && anchoring !== 'anchored'" class="badge">{{ anchoring }}</span>
      <NuxtLink v-if="link" :to="`/browse/${id}`" class="open">Open</NuxtLink>
    </header>
    <p v-if="document" class="document">
      on <a :href="document" rel="noopener" target="_blank">{{ document }}</a>
    </p>
    <p v-else-if="parent" class="document">
      reply to <NuxtLink :to="`/browse/${parent}`">{{ parent }}</NuxtLink>
    </p>
    <blockquote v-if="quote">{{ link ? excerpt(quote) : quote }}</blockquote>
    <p v-if="comment" class="comment">{{ link ? excerpt(comment, 300) : comment }}</p>
    <p v-if="tags.length > 0 || structured > 0" class="muted">
      <span v-for="tag in tags" :key="tag" class="badge">#{{ tag }}</span>
      <span v-if="structured > 0" class="badge">
        {{ structured }} structured {{ structured === 1 ? 'body' : 'bodies' }}
      </span>
    </p>
  </article>
</template>

<style scoped>
.annotation-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}

.annotation-head .open {
  margin-left: auto;
}

.document {
  margin: 0.3rem 0;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.comment {
  white-space: pre-wrap;
  margin: 0.4rem 0;
}
</style>
