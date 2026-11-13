<script setup lang="ts">
import { computed } from 'vue';
import { definePageMeta, useRoute } from '#imports';
import { bodiesOf, creatorOf, selectorsOfTarget, sourceOf, targetsOf } from '@curanno/model';
import { type BodyView, viewBody } from '../../annotations/view';
import { useApi } from '../../api/client';
import AnnotationSummary from '../../components/AnnotationSummary.vue';
import ProblemAlert from '../../components/ProblemAlert.vue';
import SharingPanel from '../../components/SharingPanel.vue';
import { useRequest } from '../../composables/request';
import { formatDate } from '../../util/time';

definePageMeta({ middleware: 'auth' });

const api = useApi();
const route = useRoute();
const id = computed(() => String(route.params['id']));

const annotation = useRequest(
  () => api.GET('/annotations/{id}', { params: { path: { id: id.value } } }),
  [id],
);
const creator = computed(() =>
  annotation.data.value ? creatorOf(annotation.data.value) : undefined,
);
const permissions = computed(() => annotation.data.value?.permissions ?? []);
const bodies = computed<BodyView[]>(() =>
  annotation.data.value ? bodiesOf(annotation.data.value).map(viewBody) : [],
);
const targets = computed(() => (annotation.data.value ? targetsOf(annotation.data.value) : []));
const raw = computed(() => JSON.stringify(annotation.data.value, null, 2));

function describeTarget(target: ReturnType<typeof targetsOf>[number]): string {
  if (typeof target === 'string') return target;
  const parts: string[] = selectorsOfTarget(target).map((s) => s.type);
  if ('anchoring' in target && target.anchoring) parts.push(`anchoring: ${target.anchoring.state}`);
  return parts.join(', ');
}
</script>

<template>
  <section>
    <h1>Annotation</h1>
    <ProblemAlert :problem="annotation.problem.value" />
    <template v-if="annotation.data.value">
      <AnnotationSummary :annotation="annotation.data.value" />
      <dl class="props">
        <dt>Identifier</dt>
        <dd>
          <code>{{ annotation.data.value.id }}</code>
        </dd>
        <dt>Created</dt>
        <dd>{{ formatDate(annotation.data.value.created) }}</dd>
        <dt>Modified</dt>
        <dd>{{ formatDate(annotation.data.value.modified) }}</dd>
        <dt>Your permissions</dt>
        <dd>
          <span v-for="p in permissions" :key="p" class="badge">{{ p }}</span>
          <span v-if="permissions.length === 0" class="muted">read only</span>
        </dd>
      </dl>

      <h2>Targets</h2>
      <ul>
        <li v-for="(target, i) in targets" :key="i">
          <a v-if="sourceOf(target)" :href="sourceOf(target)" rel="noopener" target="_blank">{{
            sourceOf(target)
          }}</a>
          <span v-if="typeof target !== 'string'" class="muted">
            ({{ describeTarget(target) }})</span
          >
        </li>
      </ul>

      <h2>Bodies</h2>
      <p v-if="bodies.length === 0 && !annotation.data.value.bodyValue" class="muted">None.</p>
      <p v-if="annotation.data.value.bodyValue">{{ annotation.data.value.bodyValue }}</p>
      <div v-for="(body, i) in bodies" :key="i" class="card">
        <template v-if="body.kind === 'iri'">
          <a :href="body.iri" rel="noopener" target="_blank">{{ body.iri }}</a>
        </template>
        <template v-else-if="body.kind === 'textual'">
          <span class="badge">TextualBody</span>
          <span v-for="p in body.purposes" :key="p" class="badge">{{ p }}</span>
          <p style="white-space: pre-wrap">{{ body.value }}</p>
        </template>
        <template v-else-if="body.kind === 'structured'">
          <span class="badge">StructuredBody</span>
          <span class="badge">{{ body.profile }}</span>
          <pre>{{ body.json }}</pre>
        </template>
        <pre v-else>{{ body.json }}</pre>
      </div>

      <template v-if="permissions.includes('share')">
        <h2>Sharing</h2>
        <SharingPanel :annotation-id="id" :creator-id="creator?.userId" />
      </template>

      <details>
        <summary>JSON-LD</summary>
        <pre>{{ raw }}</pre>
      </details>
    </template>
    <p v-else-if="annotation.pending.value" class="muted">Loading…</p>
  </section>
</template>
