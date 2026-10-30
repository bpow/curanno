<script setup lang="ts">
import { NuxtLink } from '#components';
import { useRoute } from '#imports';
import { useAuth } from '../composables/auth';

const auth = useAuth();
const route = useRoute();
</script>

<template>
  <div class="user-menu">
    <template v-if="auth.status.value === 'authenticated'">
      <NuxtLink to="/me">{{ auth.displayName.value }}</NuxtLink>
      <span v-if="auth.isAdmin.value" class="badge">admin</span>
      <button type="button" @click="auth.logout()">Sign out</button>
    </template>
    <button
      v-else-if="auth.status.value === 'anonymous'"
      type="button"
      class="primary"
      @click="auth.login(route.fullPath)"
    >
      Sign in
    </button>
  </div>
</template>

<style scoped>
.user-menu {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
</style>
