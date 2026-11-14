<script setup lang="ts">
import { Toggle, ToolbarButton, ToolbarRoot, TooltipProvider } from 'reka-ui';
import { watch } from 'vue';
import { useAuthStore } from './auth/store';
import AnnotationList from './components/AnnotationList.vue';
import AnnotationComposer from './components/AnnotationComposer.vue';
import AppIcon from './components/AppIcon.vue';
import FakeGuestPanel from './components/FakeGuestPanel.vue';
import HintTooltip from './components/HintTooltip.vue';
import ProblemAlert from './components/ProblemAlert.vue';
import UserMenu from './components/UserMenu.vue';
import { createGuest, isFakeGuest, provideGuest } from './guest';
import { useAnnotationsStore } from './stores/annotations';
import { useProfilesStore } from './stores/profiles';
import { useTextSize } from './text-size';
import { useGuestSync } from './use-guest-sync';

const guest = createGuest();
provideGuest(guest);

const auth = useAuthStore();
const store = useAnnotationsStore();
const profiles = useProfilesStore();
const textSize = useTextSize();

// Everything the list shows depends on who is asking (ADR 0006), so a new
// identity (signing in or out, or another account) starts the store afresh,
// and the set of documents follows the frames that have guests.
let identity: string | undefined;
watch(
  () => [auth.status, auth.subject, guest.documents.value.map((d) => d.uri).join('\n')] as const,
  ([status, subject, joined]) => {
    if (status === 'loading') return;
    const who = status === 'authenticated' ? `user ${subject ?? ''}` : 'anonymous';
    if (who !== identity) {
      identity = who;
      store.resetSession();
    }
    if (!joined) return;
    const uris = joined.split('\n');
    void profiles.load();
    void store.load(uris).then((current) => {
      if (current) store.startLive(uris);
    });
  },
  { immediate: true },
);

useGuestSync(guest, store);
</script>

<template>
  <TooltipProvider>
    <header class="toolbar">
      <h1>CurAnno</h1>
      <ToolbarRoot class="view-controls" aria-label="Display">
        <HintTooltip :text="guest.highlightsVisible.value ? 'Hide highlights' : 'Show highlights'">
          <ToolbarButton as-child>
            <Toggle
              class="icon"
              aria-label="Hide highlights"
              :model-value="!guest.highlightsVisible.value"
              @update:model-value="guest.showHighlights(!$event)"
            >
              <AppIcon :name="guest.highlightsVisible.value ? 'eye' : 'eye-off'" />
            </Toggle>
          </ToolbarButton>
        </HintTooltip>
        <HintTooltip text="Smaller text">
          <ToolbarButton
            class="icon"
            aria-label="Smaller text"
            :disabled="!textSize.canShrink.value"
            @click="textSize.shrink()"
          >
            <AppIcon name="text-smaller" />
          </ToolbarButton>
        </HintTooltip>
        <HintTooltip text="Larger text">
          <ToolbarButton
            class="icon"
            aria-label="Larger text"
            :disabled="!textSize.canGrow.value"
            @click="textSize.grow()"
          >
            <AppIcon name="text-larger" />
          </ToolbarButton>
        </HintTooltip>
      </ToolbarRoot>
      <UserMenu />
    </header>
    <FakeGuestPanel v-if="isFakeGuest(guest)" :guest="guest" />
    <p v-if="auth.error" class="alert" role="alert">{{ auth.error }}</p>
    <main class="content" :style="{ fontSize: `${textSize.size.value}px` }">
      <p v-if="guest.document.value" class="document muted" :title="guest.document.value.uri">
        <span class="live" :class="store.live" aria-hidden="true"></span>
        <span class="visually-hidden" role="status">Live updates: {{ store.live }}.</span>
        {{ guest.document.value.title ?? guest.document.value.uri }}
        <span v-if="guest.documents.value.length > 1" class="frames">
          and {{ guest.documents.value.length - 1 }} framed document{{
            guest.documents.value.length > 2 ? 's' : ''
          }}
        </span>
      </p>
      <ProblemAlert :problem="profiles.problem" />
      <AnnotationComposer v-if="auth.status === 'authenticated' && guest.document.value" />
      <p v-else-if="auth.status === 'anonymous'" class="muted">
        Public annotations are shown. Log in to annotate.
      </p>
      <AnnotationList />
    </main>
  </TooltipProvider>
</template>

<style scoped>
.live {
  display: inline-block;
  width: 0.5em;
  height: 0.5em;
  border-radius: 50%;
  background: var(--muted);
  margin-right: 0.3em;
}

.live.open {
  background: light-dark(#1f8f4e, #5fd38d);
}

.view-controls {
  display: flex;
  gap: 0.25rem;
}

.document {
  margin: 0 0 0.5rem;
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
