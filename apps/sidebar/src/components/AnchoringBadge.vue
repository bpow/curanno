<script setup lang="ts">
import type { AnchoringState } from '@curanno/model';
import HintTooltip from './HintTooltip.vue';

defineProps<{ state: AnchoringState | undefined }>();

const labels: Record<AnchoringState, string> = {
  anchored: 'Anchored',
  orphaned: 'Orphaned: the text was not found in the page',
  ambiguous: 'Ambiguous: the text appears more than once',
  repaired: 'Repaired by a user',
};
</script>

<template>
  <HintTooltip v-if="state && state !== 'anchored'" :text="labels[state]">
    <span class="badge" :class="state" tabindex="0">{{ state }}</span>
  </HintTooltip>
</template>

<style scoped>
.badge {
  font-size: 0.75em;
  padding: 0 0.4em;
  border-radius: 999px;
  border: 1px solid currentColor;
  text-transform: capitalize;
}

.orphaned {
  color: var(--danger);
}

.ambiguous {
  color: light-dark(#8a5a00, #ffc466);
}

.repaired {
  color: var(--muted);
}
</style>
