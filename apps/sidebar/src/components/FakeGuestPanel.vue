<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FakeGuest } from '../guest';

const props = defineProps<{ guest: FakeGuest }>();

const uri = ref(props.guest.document.value?.uri ?? '');
const quote = ref('');
watch(
  () => props.guest.document.value?.uri,
  (value) => {
    uri.value = value ?? '';
  },
);

function applyDocument(): void {
  const next = uri.value.trim();
  if (!next) return;
  props.guest.setDocument(next);
  const url = new URL(window.location.href);
  url.searchParams.set('uri', next);
  window.history.replaceState(null, '', url);
}

function select(): void {
  const text = quote.value.trim();
  if (text) props.guest.select(text);
}
</script>

<template>
  <details class="fake-guest">
    <summary>Development guest</summary>
    <p class="muted">
      No page is attached. Pick the document to annotate and type a selection to annotate it.
    </p>
    <form class="row" @submit.prevent="applyDocument">
      <label>
        Document URI
        <input v-model="uri" name="uri" type="url" required />
      </label>
      <button type="submit">Open</button>
    </form>
    <form class="row" @submit.prevent="select">
      <label>
        Selected text
        <input v-model="quote" name="quote" type="text" placeholder="Text selected in the page" />
      </label>
      <button type="submit">Select</button>
    </form>
    <ul class="log" aria-label="Guest calls">
      <li v-for="(line, i) in guest.log.value" :key="i">{{ line }}</li>
    </ul>
  </details>
</template>

<style scoped>
.fake-guest {
  border-bottom: 1px dashed var(--border);
  padding: 0.4rem 0.75rem;
  background: var(--surface-2);
}

summary {
  cursor: pointer;
  color: var(--muted);
}

.row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
  margin: 0.4rem 0;
}

label {
  flex: 1;
  display: block;
  font-size: 0.85em;
  color: var(--muted);
}

.log {
  margin: 0.3rem 0 0;
  padding-left: 1rem;
  font-family: monospace;
  font-size: 0.8em;
  color: var(--muted);
  height: 4rem;
  overflow: auto;
}
</style>
