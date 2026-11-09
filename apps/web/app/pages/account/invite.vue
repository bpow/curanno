<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { definePageMeta, useHead, useRoute } from '#imports';
import { call, tokenFrom } from '../../account/http';
import { useAuth } from '../../composables/auth';

// Where an invitation's link lands: the invited person chooses a password.
definePageMeta({ layout: 'account' });
useHead({ title: 'Create your account' });

const auth = useAuth();
const token = tokenFrom(useRoute().query['token']);
const email = ref<string>();
const invalid = ref(!token);
const displayName = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string>();
const done = ref(false);

onMounted(async () => {
  if (!token) return;
  const answer = await call<{ email: string }>('/idp/invite/peek', { body: { token } });
  if (answer.ok) email.value = answer.body.email;
  else invalid.value = true;
});

async function submit(): Promise<void> {
  if (!token || busy.value) return;
  busy.value = true;
  error.value = undefined;
  const answer = await call('/idp/invite/accept', {
    body: { token, password: password.value, displayName: displayName.value },
  });
  busy.value = false;
  if (answer.ok) done.value = true;
  else error.value = answer.message;
}
</script>

<template>
  <section>
    <h1>Create your account</h1>
    <p v-if="invalid" class="notice error" role="alert">
      This invitation has expired or was already used. Ask for a new one.
    </p>
    <template v-else-if="done">
      <p class="notice" role="status">Your account is ready.</p>
      <p><button type="button" class="primary" @click="auth.login('/')">Sign in</button></p>
    </template>
    <form v-else-if="email" @submit.prevent="submit">
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <p>
        You are signing up as <strong>{{ email }}</strong
        >; that is the login you will use.
      </p>
      <label class="field">
        Your name
        <input v-model="displayName" name="name" type="text" autocomplete="name" :disabled="busy" />
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
      <div class="actions">
        <button type="submit" class="primary" :disabled="busy">Create account</button>
      </div>
    </form>
    <p v-else class="muted">Checking the invitation…</p>
  </section>
</template>
