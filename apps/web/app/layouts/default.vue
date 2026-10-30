<script setup lang="ts">
import { ClientOnly, NuxtLink } from '#components';
import UserMenu from '../components/UserMenu.vue';
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <NuxtLink to="/" class="brand">Annotations</NuxtLink>
      <nav aria-label="Main">
        <NuxtLink to="/groups">Groups</NuxtLink>
        <NuxtLink to="/browse">Annotations</NuxtLink>
      </nav>
      <ClientOnly>
        <UserMenu />
      </ClientOnly>
    </header>
    <main class="content">
      <slot />
    </main>
  </div>
</template>
