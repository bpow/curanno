<script setup lang="ts">
import { outputSchema } from '@curanno/extract';
import { computed, ref, watch } from 'vue';
import { config } from '../config';
import { useGuest } from '../guest';
import { useProfilesStore } from '../stores/profiles';
import { useSuggestionsStore } from '../stores/suggestions';
import ProblemAlert from './ProblemAlert.vue';
import SuggestionCard from './SuggestionCard.vue';

const guest = useGuest();
const profiles = useProfilesStore();
const suggestions = useSuggestionsStore();

const CHOICE_KEY = 'curanno.suggest';

interface Choice {
  endpoint?: string;
  model?: string;
  profile?: string;
}

// A per-browser convenience only; nothing depends on it being there.
function remembered(): Choice {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}') as Choice;
  } catch {
    return {};
  }
}

function remember(choice: Choice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Storage blocked: the next visit starts from the defaults.
  }
}

const endpoints = computed(() => config.extractEndpoints);
const documents = computed(() =>
  guest.documents.value.filter((d) => guest.textDocuments.value.has(d.uri)),
);
/** Profiles the model can fill: those whose schema projects to an output schema. */
const usable = computed(() =>
  profiles.profiles.filter((p) => {
    try {
      outputSchema(p);
      return true;
    } catch {
      return false;
    }
  }),
);
const available = computed(
  () => endpoints.value.length > 0 && documents.value.length > 0 && usable.value.length > 0,
);

const saved = remembered();
const open = ref(false);
const documentUri = ref<string>();
const endpointUrl = ref(saved.endpoint ?? '');
const model = ref(saved.model ?? '');
const profileIri = ref(saved.profile ?? '');
const instructions = ref('');

const endpoint = computed(
  () => endpoints.value.find((e) => e.url === endpointUrl.value) ?? endpoints.value[0],
);
const selectedDocument = computed(
  () => documents.value.find((d) => d.uri === documentUri.value) ?? documents.value[0],
);
const profile = computed(
  () => usable.value.find((p) => p.iri === profileIri.value) ?? usable.value[0],
);
const host = computed(() => {
  try {
    return endpoint.value ? new URL(endpoint.value.url).host : '';
  } catch {
    return endpoint.value?.url ?? '';
  }
});
const running = computed(() => suggestions.status === 'reading' || suggestions.status === 'asking');

// A model the endpoint does not list is replaced by its first one.
watch(
  endpoint,
  (next) => {
    if (next?.models.length && !next.models.includes(model.value)) model.value = next.models[0]!;
  },
  { immediate: true },
);

// Suggestions, and a run still under way, belong to the page they were made on.
watch(
  () => guest.documents.value.map((d) => d.uri),
  (uris) => {
    if (suggestions.documentUri && !uris.includes(suggestions.documentUri)) {
      suggestions.clear(guest);
    }
  },
);

function start(): void {
  const doc = selectedDocument.value;
  if (!doc || !endpoint.value || !profile.value || !model.value.trim()) return;
  remember({ endpoint: endpoint.value.url, model: model.value, profile: profile.value.iri });
  open.value = false;
  void suggestions.run(guest, {
    document: doc,
    profile: profile.value,
    endpoint: endpoint.value,
    model: model.value.trim(),
    instructions: instructions.value,
  });
}
</script>

<template>
  <section v-if="available" class="suggest" aria-label="Suggested annotations">
    <div v-if="!open && !running" class="start">
      <button type="button" @click="open = true">Suggest annotations…</button>
      <button
        v-if="suggestions.items.length || suggestions.status !== 'idle'"
        type="button"
        class="link"
        @click="suggestions.clear(guest)"
      >
        Clear suggestions
      </button>
    </div>

    <form v-if="open" class="form" @submit.prevent="start">
      <label v-if="documents.length > 1">
        Document
        <select v-model="documentUri" name="document">
          <option v-for="d in documents" :key="d.uri" :value="d.uri">{{ d.title ?? d.uri }}</option>
        </select>
      </label>
      <label>
        Kind of annotation
        <select v-model="profileIri" name="profile">
          <option v-for="p in usable" :key="p.iri" :value="p.iri">{{ p.title }}</option>
        </select>
      </label>
      <label v-if="endpoints.length > 1">
        Model server
        <select v-model="endpointUrl" name="endpoint">
          <option v-for="e in endpoints" :key="e.url" :value="e.url">{{ e.label }}</option>
        </select>
      </label>
      <label>
        Model
        <select v-if="endpoint?.models.length" v-model="model" name="model">
          <option v-for="m in endpoint.models" :key="m" :value="m">{{ m }}</option>
        </select>
        <input v-else v-model="model" name="model" required placeholder="for example llama3.1:8b" />
      </label>
      <label>
        Guidance for the model (optional)
        <textarea
          v-model="instructions"
          name="instructions"
          rows="2"
          placeholder="for example: only individuals with a variant in MYH7"
        ></textarea>
      </label>
      <p class="muted note">
        The text of {{ selectedDocument?.title ?? 'this page' }} is sent to
        <strong>{{ host }}</strong> ({{ endpoint?.label }}). Suggestions are not saved until you
        save each one.
      </p>
      <div class="actions">
        <button type="submit" class="primary">Suggest</button>
        <button type="button" @click="open = false">Cancel</button>
      </div>
    </form>

    <p v-if="running" role="status" class="status">
      <template v-if="suggestions.status === 'reading'">Reading the page…</template>
      <template v-else-if="suggestions.progress">
        Asking the model: {{ suggestions.progress.done }} of {{ suggestions.progress.total }} parts
        read…
      </template>
      <template v-else>Asking the model…</template>
      <button type="button" @click="suggestions.cancel()">Stop</button>
    </p>
    <p v-else-if="suggestions.status === 'failed'" class="alert" role="alert">
      {{ suggestions.error }}
    </p>
    <p v-else-if="suggestions.status === 'cancelled'" role="status" class="muted status">
      Stopped.
    </p>
    <p v-else-if="suggestions.status === 'done'" role="status" class="muted status">
      {{
        suggestions.items.length === 1 ? '1 suggestion' : `${suggestions.items.length} suggestions`
      }}<template v-if="suggestions.rejected">
        ; {{ suggestions.rejected }} set aside because their quote was not in the page or their
        value did not fit the profile</template
      >.
    </p>

    <ProblemAlert :problem="suggestions.shareProblem" />
    <ul v-if="suggestions.items.length" class="list">
      <SuggestionCard v-for="item in suggestions.items" :key="item.id" :item="item" />
    </ul>
  </section>
</template>

<style scoped>
.suggest {
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--accent);
  border-radius: 6px;
  margin-bottom: 0.75rem;
}

.start,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.form {
  display: grid;
  gap: 0.5rem;
}

.form label {
  display: grid;
  gap: 0.2rem;
}

.note,
.status {
  font-size: 0.9em;
  margin: 0.4rem 0 0;
}

.status button {
  margin-left: 0.5rem;
}

.list {
  margin: 0.5rem 0 0;
  padding: 0;
}
</style>
