<script setup lang="ts">
import { NuxtLink } from '#components';
import { useAuth } from '../composables/auth';

const auth = useAuth();
</script>

<template>
  <NuxtLink v-if="auth.isAdmin.value" to="/users">Users</NuxtLink>
</template>
