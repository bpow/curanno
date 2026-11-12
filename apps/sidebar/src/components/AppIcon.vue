<script setup lang="ts">
const PATHS = {
  reply: ['M9 15 4 10l5-5', 'M4 10h10a6 6 0 0 1 6 6v3'],
  edit: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
  share: [
    'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M2.5 20a6.5 6.5 0 0 1 13 0',
    'M19 8v6',
    'M16 11h6',
  ],
  delete: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  'eye-off': [
    'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M3 3l18 18',
  ],
  'text-smaller': ['M3 19 8 5l5 14', 'M4.8 14h6.4', 'M16 12h6'],
  'text-larger': ['M3 19 8 5l5 14', 'M4.8 14h6.4', 'M16 12h6', 'M19 9v6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
} as const;

export type IconName = keyof typeof PATHS;

defineProps<{ name: IconName }>();
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in PATHS[name]" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  width: 1.2em;
  height: 1.2em;
  display: block;
  flex: none;
}
</style>
