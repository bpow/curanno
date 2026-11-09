<script setup lang="ts">
import { NuxtLink } from '#components';
import { definePageMeta } from '#imports';
import { computed } from 'vue';
import { useApi } from '../api/client';
import AccountSettings from '../components/AccountSettings.vue';
import ProblemAlert from '../components/ProblemAlert.vue';
import UserCard from '../components/UserCard.vue';
import { useAuth } from '../composables/auth';
import { useRequest } from '../composables/request';

definePageMeta({ middleware: 'auth' });

const api = useApi();
const auth = useAuth();
/** Only an account of the embedded issuer has a password and addresses to manage here. */
const selfIssued = computed(() => auth.user.value?.profile.iss === window.location.origin);
const me = useRequest(() => api.GET('/x/me'));
</script>

<template>
  <section>
    <h1>Your account</h1>
    <ProblemAlert :problem="me.problem.value" />
    <template v-if="me.data.value">
      <UserCard :user="me.data.value" />
      <p v-if="me.data.value.isAdmin">
        <NuxtLink :to="`/users/${me.data.value.id}`">Edit your profile</NuxtLink>
      </p>
      <p class="muted">
        Signed in through {{ auth.user.value?.profile.iss }} as
        {{ auth.user.value?.profile.preferred_username ?? auth.user.value?.profile.sub }}.
      </p>
      <AccountSettings v-if="selfIssued" />
      <p><button type="button" @click="auth.logout()">Sign out</button></p>
    </template>
    <p v-else-if="me.pending.value" class="muted">Loading…</p>
  </section>
</template>
