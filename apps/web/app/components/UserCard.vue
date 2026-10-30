<script setup lang="ts">
import type { User } from '@scale/api-client';
import { NuxtLink } from '#components';
import { formatDate } from '../util/time';

defineProps<{ user: User }>();
</script>

<template>
  <dl class="props">
    <dt>Name</dt>
    <dd>{{ user.displayName ?? '—' }}</dd>
    <dt>Email</dt>
    <dd>{{ user.email ?? '—' }}</dd>
    <dt>Role</dt>
    <dd>{{ user.isAdmin ? 'Platform administrator' : 'User' }}</dd>
    <dt>Member since</dt>
    <dd>{{ formatDate(user.created) }}</dd>
    <dt>Groups</dt>
    <dd>
      <template v-if="user.groups && user.groups.length > 0">
        <template v-for="(group, i) in user.groups" :key="group.id">
          <span v-if="i > 0">, </span>
          <NuxtLink :to="`/groups/${group.id}`">{{ group.name }}</NuxtLink>
        </template>
      </template>
      <span v-else class="muted">none</span>
    </dd>
    <dt>Annotations</dt>
    <dd><NuxtLink :to="{ path: '/browse', query: { creator: user.id } }">Browse</NuxtLink></dd>
  </dl>
</template>
