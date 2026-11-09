<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, useHead } from '#imports';
import { NuxtLink } from '#components';
import { call } from '../../account/http';

// Asks for an account. Under approval it is not usable until an administrator agrees.
definePageMeta({ layout: 'account' });
useHead({ title: 'Create an account' });

const policy = ref<'closed' | 'approval' | 'open'>();
const displayName = ref('');
const email = ref('');
const password = ref('');
const note = ref('');
const busy = ref(false);
const error = ref<string>();
const outcome = ref<'pending' | 'active'>();

onMounted(async () => {
  const options = await call<{ signup?: 'closed' | 'approval' | 'open' }>('/auth/options');
  policy.value = options.ok ? (options.body.signup ?? 'closed') : 'closed';
});

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = undefined;
  const answer = await call<{ status: 'pending' | 'active' }>('/auth/signup', {
    body: {
      email: email.value,
      password: password.value,
      displayName: displayName.value,
      note: note.value,
    },
  });
  busy.value = false;
  if (answer.ok) outcome.value = answer.body.status;
  else error.value = answer.message;
}
</script>

<template>
  <section>
    <h1>Create an account</h1>
    <p v-if="policy === 'closed'" class="notice" role="status">
      Accounts here are created by invitation. Ask an administrator for one.
    </p>
    <template v-else-if="outcome === 'pending'">
      <p class="notice" role="status">
        Thank you. Your application is waiting for an administrator, and you will be told by email
        when it is decided. Check your email to verify your address, which can speed that up.
      </p>
    </template>
    <template v-else-if="outcome === 'active'">
      <p class="notice" role="status">Your account is ready. Sign in from the application.</p>
    </template>
    <form v-else-if="policy" @submit.prevent="submit">
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <label class="field">
        Your name
        <input
          v-model="displayName"
          name="name"
          type="text"
          autocomplete="name"
          required
          :disabled="busy"
        />
      </label>
      <label class="field">
        Email address (this is your login)
        <input
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          :disabled="busy"
        />
      </label>
      <label class="field">
        Password (at least 10 characters)
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="new-password"
          minlength="10"
          required
          :disabled="busy"
        />
      </label>
      <label v-if="policy === 'approval'" class="field">
        Why would you like to join? (optional)
        <textarea v-model="note" name="note" rows="3" maxlength="1000" :disabled="busy" />
      </label>
      <div class="actions">
        <button type="submit" class="primary" :disabled="busy">
          {{ policy === 'approval' ? 'Apply' : 'Create account' }}
        </button>
      </div>
      <p><NuxtLink to="/">Back</NuxtLink></p>
    </form>
    <p v-else class="muted">Loading…</p>
  </section>
</template>
