<script setup lang="ts">
import { computed } from 'vue';
import { useAuth } from '../composables/auth';

// Tells a signed-in user who cannot act yet why, instead of leaving them to meet 403s.
const auth = useAuth();
const message = computed(() => {
  switch (auth.me.value?.status) {
    case 'pending':
      return 'Your account is waiting for approval by an administrator. You can read what is public until then, and you will be told by email when it is decided.';
    case 'rejected':
      return 'Your application was not approved.';
    case 'disabled':
      return 'Your account is disabled. Ask an administrator.';
    default:
      return undefined;
  }
});
</script>

<template>
  <p v-if="message" class="notice" role="status">{{ message }}</p>
</template>
