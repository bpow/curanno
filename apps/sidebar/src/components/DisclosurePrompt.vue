<script setup lang="ts">
import { computed } from 'vue';
import { useGuest } from '../guest';

const guest = useGuest();

/**
 * Annotations kept from the page because they were made on another site
 * (ADR 0025), one group per site and page origin, with the choice to send
 * them for this session.
 */
const groups = computed(() => {
  const byPair = new Map<string, { pageOrigin: string; source: string; count: number }>();
  for (const { pageOrigin, source } of guest.withheld.value.values()) {
    const key = JSON.stringify([pageOrigin, source]);
    const group = byPair.get(key) ?? { pageOrigin, source, count: 0 };
    group.count += 1;
    byPair.set(key, group);
  }
  return [...byPair.values()];
});

function hostOf(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : undefined;
  } catch {
    return undefined;
  }
}
</script>

<template>
  <section
    v-for="group in groups"
    :key="`${group.pageOrigin} ${group.source}`"
    class="disclosure"
    :aria-label="`Annotations made on ${group.source}`"
  >
    <p>
      {{ group.count === 1 ? '1 annotation here was' : `${group.count} annotations here were` }}
      made on <strong>{{ group.source }}</strong> and {{ group.count === 1 ? 'is' : 'are' }} not
      highlighted on this page.
    </p>
    <template v-if="hostOf(group.pageOrigin)">
      <button type="button" @click="guest.allow(group.pageOrigin, group.source)">
        Highlight on {{ hostOf(group.pageOrigin) }}
      </button>
      <p class="muted note">
        This sends their quoted text to {{ hostOf(group.pageOrigin) }}. It applies to annotations
        from {{ group.source }} on that site until you close this tab.
      </p>
    </template>
  </section>
</template>

<style scoped>
.disclosure {
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 0.9em;
}

.disclosure p {
  margin: 0 0 0.4rem;
}

.note {
  font-size: 0.85em;
  margin: 0.4rem 0 0;
}
</style>
