<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from '#imports';
import { useAuth } from '../composables/auth';

const route = useRoute();
const auth = useAuth();
const error = ref<string>();

onMounted(async () => {
  const returnTo = typeof route.query['returnTo'] === 'string' ? route.query['returnTo'] : '/';
  try {
    await auth.login(returnTo);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <section>
    <h1>Signing in</h1>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-else class="muted">Redirecting to the identity provider…</p>
  </section>
</template>
