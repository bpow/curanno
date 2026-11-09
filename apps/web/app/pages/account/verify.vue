<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, useHead, useRoute } from '#imports';
import { NuxtLink } from '#components';
import { call, tokenFrom } from '../../account/http';

// Where a verification link lands; the address is confirmed as the page opens.
definePageMeta({ layout: 'account' });
useHead({ title: 'Verify your address' });

const token = tokenFrom(useRoute().query['token']);
const state = ref<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
const message = ref('This link has expired or was already used.');
const email = ref('');

onMounted(async () => {
  if (!token) return;
  const answer = await call<{ email: string }>('/idp/email/verify', { body: { token } });
  if (answer.ok) {
    email.value = answer.body.email;
    state.value = 'done';
  } else {
    message.value = answer.message;
    state.value = 'failed';
  }
});
</script>

<template>
  <section>
    <h1>Verify your address</h1>
    <p v-if="state === 'working'" class="muted">Verifying…</p>
    <p v-else-if="state === 'done'" class="notice" role="status">
      {{ email }} is verified. <NuxtLink to="/me">Go to your account</NuxtLink>.
    </p>
    <p v-else class="notice error" role="alert">{{ message }}</p>
  </section>
</template>
