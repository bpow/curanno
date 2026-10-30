<script setup lang="ts">
import type { AnchoringState } from '@curanno/model';

defineProps<{ state: AnchoringState | undefined }>();

const labels: Record<AnchoringState, string> = {
  anchored: 'Anchored',
  orphaned: 'Orphaned: the text was not found in the page',
  ambiguous: 'Ambiguous: the text appears more than once',
  repaired: 'Repaired by a user',
};
</script>

<template>
  <span v-if="state && state !== 'anchored'" class="badge" :class="state" :title="labels[state]">
    {{ state }}
  </span>
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
