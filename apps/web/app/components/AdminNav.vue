<script setup lang="ts">
import { NuxtLink } from '#components';
import { useAuth } from '../composables/auth';

const auth = useAuth();
</script>

<template>
  <template v-if="auth.isAdmin.value">
    <NuxtLink to="/users">Users</NuxtLink>
    <NuxtLink to="/applications">Applications</NuxtLink>
  </template>
</template>
