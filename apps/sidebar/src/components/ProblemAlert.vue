<script setup lang="ts">
import type { Problem } from '@curanno/api-client';

defineProps<{ problem: Problem | undefined }>();
</script>

<template>
  <div v-if="problem" class="alert" role="alert">
    <strong>{{ problem.title }}</strong>
    <span v-if="problem.status === 401"> — log in to continue.</span>
    <span v-else-if="problem.detail"> — {{ problem.detail }}</span>
    <ul v-if="problem.errors?.length" class="errors">
      <li v-for="(e, i) in problem.errors" :key="i">
        <code v-if="e.instancePath">{{ e.instancePath }}</code> {{ e.message }}
      </li>
    </ul>
    <slot />
  </div>
</template>

<style scoped>
.errors {
  margin: 0.3rem 0 0;
  padding-left: 1.2rem;
}
</style>
