<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useAuthStore } from './auth/store';
import AnnotationList from './components/AnnotationList.vue';
import AnnotationComposer from './components/AnnotationComposer.vue';
import FakeGuestPanel from './components/FakeGuestPanel.vue';
import ProblemAlert from './components/ProblemAlert.vue';
import UserMenu from './components/UserMenu.vue';
import { createGuest, isFakeGuest, provideGuest } from './guest';
import { useAnnotationsStore } from './stores/annotations';
import { useProfilesStore } from './stores/profiles';
import { useGuestSync } from './use-guest-sync';

const guest = createGuest();
provideGuest(guest);

const auth = useAuthStore();
const store = useAnnotationsStore();
const profiles = useProfilesStore();

onMounted(() => void auth.init());

// Everything the list shows depends on who is asking (ADR 0006), so the
// document is reloaded whenever the session or the document changes.
watch(
  () => [auth.status, guest.document.value?.uri] as const,
  ([status, uri]) => {
    if (status === 'loading' || !uri) return;
    void profiles.load();
    void store.load(uri);
  },
  { immediate: true },
);

useGuestSync(guest, store);
</script>

<template>
  <header class="toolbar">
    <h1>Annotations</h1>
    <UserMenu />
  </header>
  <FakeGuestPanel v-if="isFakeGuest(guest)" :guest="guest" />
  <p v-if="auth.error" class="alert" role="alert">{{ auth.error }}</p>
  <main class="content">
    <p v-if="guest.document.value" class="document muted" :title="guest.document.value.uri">
      {{ guest.document.value.title ?? guest.document.value.uri }}
    </p>
    <ProblemAlert :problem="profiles.problem" />
    <AnnotationComposer v-if="auth.status === 'authenticated' && guest.document.value" />
    <p v-else-if="auth.status === 'anonymous'" class="muted">
      Public annotations are shown. Log in to annotate.
    </p>
    <AnnotationList />
  </main>
</template>

<style scoped>
.document {
  margin: 0 0 0.5rem;
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
