<script setup lang="ts">
import { ClientOnly, NuxtLink } from '#components';
import UserMenu from '../components/UserMenu.vue';
import AdminNav from '../components/AdminNav.vue';
import AccountStatusBanner from '../components/AccountStatusBanner.vue';
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <NuxtLink to="/" class="brand">Annotations</NuxtLink>
      <nav aria-label="Main">
        <NuxtLink to="/groups">Groups</NuxtLink>
        <NuxtLink to="/browse">Annotations</NuxtLink>
        <ClientOnly><AdminNav /></ClientOnly>
      </nav>
      <ClientOnly>
        <UserMenu />
      </ClientOnly>
    </header>
    <main class="content">
      <ClientOnly><AccountStatusBanner /></ClientOnly>
      <slot />
    </main>
  </div>
</template>
