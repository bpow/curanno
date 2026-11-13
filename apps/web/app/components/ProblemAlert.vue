<script setup lang="ts">
import type { Problem } from '@curanno/api-client';

defineProps<{ problem: Problem | null | undefined }>();
</script>

<template>
  <p v-if="problem" class="notice error" role="alert">
    <strong>{{ problem.title }}</strong>
    <template v-if="problem.detail"> — {{ problem.detail }}</template>
  </p>
</template>
