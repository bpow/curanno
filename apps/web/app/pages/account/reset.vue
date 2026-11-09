<script setup lang="ts">
import { ref } from 'vue';
import { definePageMeta, useHead, useRoute } from '#imports';
import { call, tokenFrom } from '../../account/http';
import { useAuth } from '../../composables/auth';

// Where a reset link lands: the user chooses a new password.
definePageMeta({ layout: 'account' });
useHead({ title: 'Choose a new password' });

const auth = useAuth();
const token = tokenFrom(useRoute().query['token']);
const password = ref('');
const busy = ref(false);
const error = ref<string>();
const done = ref(false);

async function submit(): Promise<void> {
  if (!token || busy.value) return;
  busy.value = true;
  error.value = undefined;
  const answer = await call('/auth/reset/complete', { body: { token, password: password.value } });
  busy.value = false;
  if (answer.ok) done.value = true;
  else error.value = answer.message;
}
</script>

<template>
  <section>
    <h1>Choose a new password</h1>
    <p v-if="!token" class="notice error" role="alert">
      This link has expired or was already used. Ask for a new one.
    </p>
    <template v-else-if="done">
      <p class="notice" role="status">
        Your password is changed, and you are signed out everywhere.
      </p>
      <p><button type="button" class="primary" @click="auth.login('/')">Sign in</button></p>
    </template>
    <form v-else @submit.prevent="submit">
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <label class="field">
        New password (at least 10 characters)
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
      <div class="actions">
        <button type="submit" class="primary" :disabled="busy">Change password</button>
      </div>
    </form>
  </section>
</template>
