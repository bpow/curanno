<script setup lang="ts">
import { computed, ref } from 'vue';
import { definePageMeta, useHead, useRoute } from '#imports';

// The page the embedded issuer sends the browser to while it signs someone in
// (ADR 0028). It posts the credentials back to the interaction the issuer
// started, which is scoped to its own path by a cookie, and then follows the
// address the issuer answers with to resume the flow.
definePageMeta({ layout: 'account' });
useHead({ title: 'Sign in' });

const route = useRoute();
const uid = computed(() => {
  const value = route.query['uid'];
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value) ? value : undefined;
});
const login = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string>();
const expired = ref(false);

async function post(action: 'login' | 'abort', body: object): Promise<Response> {
  return fetch(`/oidc/interaction/${uid.value}/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Resume the flow, but only on this origin: the issuer is here, so nothing else is right. */
function resume(address: unknown): void {
  const target = typeof address === 'string' ? new URL(address, window.location.origin) : undefined;
  if (target?.origin !== window.location.origin) {
    error.value = 'The sign-in could not continue. Try again.';
    return;
  }
  window.location.assign(target.href);
}

async function submit(): Promise<void> {
  if (!uid.value || busy.value) return;
  busy.value = true;
  error.value = undefined;
  try {
    const res = await post('login', { login: login.value, password: password.value });
    if (res.ok) {
      resume(((await res.json()) as { redirectTo?: unknown }).redirectTo);
      return;
    }
    password.value = '';
    if (res.status === 401) error.value = 'The login or the password is not right.';
    else if (res.status === 400) expired.value = true;
    else error.value = 'Signing in failed. Try again.';
  } catch {
    error.value = 'The server could not be reached. Try again.';
  } finally {
    busy.value = false;
  }
}

async function cancel(): Promise<void> {
  if (!uid.value || busy.value) return;
  busy.value = true;
  try {
    const res = await post('abort', {});
    if (res.ok) resume(((await res.json()) as { redirectTo?: unknown }).redirectTo);
    else expired.value = true;
  } catch {
    error.value = 'The server could not be reached. Try again.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section>
    <h1>Sign in</h1>
    <p v-if="!uid" class="notice error" role="alert">
      This page is part of signing in. Open the application and sign in from there.
    </p>
    <p v-else-if="expired" class="notice error" role="alert">
      This sign-in has expired or was not started in this browser. Close this window and sign in
      again.
    </p>
    <form v-else @submit.prevent="submit">
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <label class="field">
        Email or user name
        <input
          v-model="login"
          name="login"
          type="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          :disabled="busy"
        />
      </label>
      <label class="field">
        Password
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          :disabled="busy"
        />
      </label>
      <div class="actions">
        <button type="submit" class="primary" :disabled="busy">Sign in</button>
        <button type="button" class="link" :disabled="busy" @click="cancel">Cancel</button>
      </div>
    </form>
  </section>
</template>
