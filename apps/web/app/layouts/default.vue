<script setup lang="ts">
import { NuxtLink } from '#components';
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <NuxtLink to="/" class="brand">Annotations</NuxtLink>
      <nav aria-label="Main">
        <NuxtLink to="/groups">Groups</NuxtLink>
        <NuxtLink to="/browse">Annotations</NuxtLink>
      </nav>
    </header>
    <main class="content">
      <slot />
    </main>
  </div>
</template>
