<script setup lang="ts">
import type { AclEntry, PrincipalRef } from '@curanno/api-client';
import type { JsonValue, Permission, ValidationError } from '@curanno/model';
import { computed, ref, shallowRef, watch } from 'vue';
import type { AnnotationDraft } from '../api/annotations';
import type { Problem } from '../api/problems';
import { useProfilesStore } from '../stores/profiles';
import AclEditor from './AclEditor.vue';
import ProblemAlert from './ProblemAlert.vue';
import StructuredBodyEditor from './StructuredBodyEditor.vue';
import TextualBodyEditor from './TextualBodyEditor.vue';

const props = defineProps<{
  draft: AnnotationDraft;
  submitLabel?: string | undefined;
  busy?: boolean | undefined;
  problem?: Problem | undefined;
  placeholder?: string | undefined;
  /** Offer sharing controls whose grants go out with the draft (new annotations only). */
  sharing?: boolean | undefined;
}>();
const emit = defineEmits<{ save: [draft: AnnotationDraft]; cancel: []; reload: [] }>();

const profiles = useProfilesStore();

const text = ref(props.draft.text);
const tags = ref<string[]>([...props.draft.tags]);
const profileIri = ref(props.draft.structured?.profile ?? '');
const structuredValue = shallowRef<JsonValue>(props.draft.structured?.value ?? {});
const errors = ref<ValidationError[]>([]);
const acl = ref<AclEntry[]>([...(props.draft.acl ?? [])]);

// A reload after a conflict replaces the draft under the editor.
watch(
  () => props.draft,
  (draft) => {
    text.value = draft.text;
    tags.value = [...draft.tags];
    profileIri.value = draft.structured?.profile ?? '';
    structuredValue.value = draft.structured?.value ?? {};
    errors.value = [];
    acl.value = [...(draft.acl ?? [])];
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

function toggleGrant(principal: PrincipalRef, permission: Permission, grant: boolean): void {
  const rest = acl.value.filter(
    (e) => !(e.principal.id === principal.id && e.permission === permission),
  );
  acl.value = grant ? [...rest, { principal, permission }] : rest;
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
  if (props.sharing && acl.value.length) draft.acl = acl.value;
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
    <details v-if="sharing" class="sharing">
      <summary>
        Sharing
        <span class="muted">{{
          acl.length ? `(${new Set(acl.map((e) => e.principal.id)).size} shared)` : '(only you)'
        }}</span>
      </summary>
      <AclEditor :entries="acl" :busy="busy" @toggle="toggleGrant" />
    </details>
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

.sharing summary {
  font-size: 0.9em;
  color: var(--muted);
  cursor: pointer;
}

.sharing[open] summary {
  margin-bottom: 0.4rem;
}

.conflict {
  margin: 0;
}

.actions {
  display: flex;
  gap: 0.5rem;
}
</style>
