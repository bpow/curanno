<script setup lang="ts">
import { useAuthStore } from '../auth/store';

const auth = useAuthStore();
</script>

<template>
  <div class="user-menu">
    <template v-if="auth.status === 'loading'">
      <span class="muted">Checking session…</span>
    </template>
    <template v-else-if="auth.status === 'authenticated'">
      <span class="user-name" :title="auth.subject">{{ auth.displayName }}</span>
      <button type="button" @click="auth.logout()">Log out</button>
    </template>
    <template v-else>
      <button type="button" class="primary" @click="auth.login()">Log in</button>
    </template>
  </div>
</template>

<style scoped>
.user-menu {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.user-name {
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
