<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { buildInput, emptyDraft, type AnnotationDraft } from '../api/annotations';
import { toProblem, type Problem } from '../api/problems';
import { useGuest } from '../guest';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import AnnotationEditor from './AnnotationEditor.vue';

const guest = useGuest();
const store = useAnnotationsStore();
const profiles = useProfilesStore();

type Kind = 'selection' | 'page';
const open = ref<Kind>();
const busy = ref(false);
const problem = ref<Problem>();
const draft = ref<AnnotationDraft>(emptyDraft());

const selection = computed(() => guest.selection.value);
watch(selection, (next) => {
  if (open.value === 'selection' && !next) open.value = undefined;
});

function start(kind: Kind): void {
  open.value = kind;
  draft.value = emptyDraft();
  problem.value = undefined;
}

async function save(next: AnnotationDraft): Promise<void> {
  const doc = guest.document.value;
  if (!doc) return;
  const target = open.value === 'selection' ? selection.value?.target : doc.uri;
  if (!target) return;
  busy.value = true;
  try {
    await store.ensureDocument(doc);
    const structuredPurpose = next.structured
      ? profiles.purposeOf(next.structured.profile)
      : undefined;
    const created = await store.create(
      buildInput(next, target, structuredPurpose ? { structuredPurpose } : {}),
    );
    guest.anchor([{ id: created.annotation.id, target: created.annotation.target }]);
    if (open.value === 'selection') guest.clearSelection();
    open.value = undefined;
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="composer" aria-label="New annotation">
    <div v-if="!open" class="start">
      <button v-if="selection" type="button" class="primary" @click="start('selection')">
        Annotate selection
      </button>
      <button type="button" @click="start('page')">New page note</button>
      <blockquote v-if="selection" class="quote">{{ selection.quote }}</blockquote>
    </div>
    <template v-else>
      <blockquote v-if="open === 'selection' && selection" class="quote">
        {{ selection.quote }}
      </blockquote>
      <p v-else class="muted">A note on the whole page</p>
      <AnnotationEditor
        :draft="draft"
        submit-label="Post"
        :busy="busy"
        :problem="problem"
        @save="save"
        @cancel="open = undefined"
      />
    </template>
  </section>
</template>

<style scoped>
.composer {
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: 6px;
  margin-bottom: 0.75rem;
}

.start {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.quote {
  flex-basis: 100%;
  margin: 0.3rem 0;
  padding: 0.2rem 0.6rem;
  border-left: 3px solid light-dark(#f2c94c, #a67c00);
  color: var(--muted);
  font-style: italic;
  overflow-wrap: anywhere;
}
</style>
