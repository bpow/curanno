<script setup lang="ts">
import type { JsonValue, ValidationError } from '@scale/model';
import { computed, ref, shallowRef, watch } from 'vue';
import type { AnnotationDraft } from '../api/annotations';
import type { Problem } from '../api/problems';
import { useProfilesStore } from '../stores/profiles';
import ProblemAlert from './ProblemAlert.vue';
import StructuredBodyEditor from './StructuredBodyEditor.vue';
import TextualBodyEditor from './TextualBodyEditor.vue';

const props = defineProps<{
  draft: AnnotationDraft;
  submitLabel?: string | undefined;
  busy?: boolean | undefined;
  problem?: Problem | undefined;
  placeholder?: string | undefined;
}>();
const emit = defineEmits<{ save: [draft: AnnotationDraft]; cancel: []; reload: [] }>();

const profiles = useProfilesStore();

const text = ref(props.draft.text);
const tags = ref<string[]>([...props.draft.tags]);
const profileIri = ref(props.draft.structured?.profile ?? '');
const structuredValue = shallowRef<JsonValue>(props.draft.structured?.value ?? {});
const errors = ref<ValidationError[]>([]);

// A reload after a conflict replaces the draft under the editor.
watch(
  () => props.draft,
  (draft) => {
    text.value = draft.text;
    tags.value = [...draft.tags];
    profileIri.value = draft.structured?.profile ?? '';
    structuredValue.value = draft.structured?.value ?? {};
    errors.value = [];
  },
);

const profile = computed(() => (profileIri.value ? profiles.byIri(profileIri.value) : undefined));
const conflict = computed(() => props.problem?.status === 412);
const empty = computed(
  () => !text.value.trim() && tags.value.length === 0 && profile.value === undefined,
);

function onProfileChange(event: Event): void {
  profileIri.value = (event.target as HTMLSelectElement).value;
  structuredValue.value = {};
  errors.value = [];
}

function submit(): void {
  const draft: AnnotationDraft = { text: text.value, tags: tags.value };
  if (profile.value) {
    draft.structured = { profile: profile.value.iri, value: structuredValue.value };
    errors.value = profiles.validate({
      type: 'StructuredBody',
      profile: profile.value.iri,
      value: structuredValue.value,
    });
    if (errors.value.length) return;
  }
  emit('save', draft);
}
</script>

<template>
  <form class="editor" @submit.prevent="submit">
    <TextualBodyEditor v-model="text" v-model:tags="tags" :placeholder="placeholder" />
    <label v-if="profiles.profiles.length" class="profile-pick">
      Structured data
      <select name="profile" :value="profileIri" @change="onProfileChange">
        <option value="">None</option>
        <option v-for="p in profiles.profiles" :key="p.iri" :value="p.iri">{{ p.title }}</option>
      </select>
    </label>
    <StructuredBodyEditor
      v-if="profile"
      v-model="structuredValue"
      :profile="profile"
      :errors="errors"
    />
    <ProblemAlert :problem="conflict ? undefined : problem" />
    <div v-if="conflict" class="alert conflict" role="alert">
      Someone else changed this annotation since you opened it.
      <button type="button" class="link" @click="emit('reload')">Load the latest version</button>
      and apply your change again.
    </div>
    <div class="actions">
      <button type="submit" class="primary" :disabled="busy || empty">
        {{ submitLabel ?? 'Save' }}
      </button>
      <button type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 0.5rem;
  margin: 0.4rem 0;
}

.profile-pick {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.9em;
  color: var(--muted);
}

.profile-pick select {
  width: auto;
}

.conflict {
  margin: 0;
}

.actions {
  display: flex;
  gap: 0.5rem;
}
</style>
