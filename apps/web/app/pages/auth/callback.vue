<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { navigateTo } from '#imports';
import { useAuth } from '../../composables/auth';

const auth = useAuth();
const error = ref<string>();

onMounted(async () => {
  try {
    const returnTo = await auth.completeLogin();
    await navigateTo(returnTo, { replace: true });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <section>
    <h1>Signing in</h1>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-else class="muted">Completing sign-in…</p>
  </section>
</template>
