<script setup lang="ts">
import { NuxtLink } from '#components';
</script>

<template>
  <section class="prose">
    <h1>Annotation platform</h1>
    <p>
      Manage users, groups and sharing, and browse the annotations you may read. Everything here
      goes through the public API with your own login.
    </p>
    <p>
      <NuxtLink to="/groups">Groups</NuxtLink> ·
      <NuxtLink to="/browse">Annotations</NuxtLink>
    </p>
  </section>
</template>
