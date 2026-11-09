<script setup lang="ts">
import { ref } from 'vue';
import { definePageMeta, useHead } from '#imports';
import { call } from '../../account/http';

// Asks for a password-reset link. The answer is the same for every address.
definePageMeta({ layout: 'account' });
useHead({ title: 'Forgot your password' });

const email = ref('');
const busy = ref(false);
const error = ref<string>();
const sent = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = undefined;
  const answer = await call('/auth/reset/request', { body: { email: email.value } });
  busy.value = false;
  if (answer.ok) sent.value = true;
  else error.value = answer.message;
}
</script>

<template>
  <section>
    <h1>Forgot your password</h1>
    <p v-if="sent" class="notice" role="status">
      If an account has that address, a message with a link to choose a new password is on its way.
      The link works once, for an hour.
    </p>
    <form v-else @submit.prevent="submit">
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <label class="field">
        Your email address
        <input
          v-model="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          :disabled="busy"
        />
      </label>
      <div class="actions">
        <button type="submit" class="primary" :disabled="busy">Send the link</button>
      </div>
    </form>
  </section>
</template>
