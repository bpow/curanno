<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from './auth/store';
import UserMenu from './components/UserMenu.vue';

const auth = useAuthStore();
onMounted(() => void auth.init());
</script>

<template>
  <header class="toolbar">
    <h1>Annotations</h1>
    <UserMenu />
  </header>
  <p v-if="auth.error" class="alert" role="alert">{{ auth.error }}</p>
  <main class="content"></main>
</template>
