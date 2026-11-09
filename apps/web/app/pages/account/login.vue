<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NuxtLink } from '#components';
import { definePageMeta, useHead, useRoute } from '#imports';
import { call } from '../../account/http';

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
/** Whether the server can send mail, and so whether a forgotten password can be reset. */
const canReset = ref(false);
const canSignUp = ref(false);
const providers = ref<{ id: string; label: string }[]>([]);
/** The upstream identity waiting to join the account this person signs in to. */
const pendingLabel = ref<string>();
const pendingEmail = ref<string>();
const link = computed(() => {
  const value = route.query['link'];
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value) ? value : undefined;
});

const ERRORS: Record<string, string> = {
  expired: 'That sign-in took too long or was already used. Try again.',
  browser: 'That sign-in was started in another browser. Start again here.',
  denied: 'The sign-in was cancelled.',
  failed: 'The other service could not confirm who you are. Try again.',
  disabled: 'This account is disabled. Ask an administrator.',
  closed: 'Accounts here are by invitation. Ask an administrator.',
  paused: 'New applications are paused for now. Try later.',
  'use-existing':
    'An account with that address exists, but it has no password to confirm it with. Sign in the way you did before, then connect the other account from your account page.',
  owned: 'That account is already connected to someone else.',
};
const upstreamError = computed(() => {
  const code = route.query['error'];
  return typeof code === 'string' ? ERRORS[code] : undefined;
});

onMounted(async () => {
  const options = await call<{
    mail?: boolean;
    signup?: string;
    providers?: { id: string; label: string }[];
  }>('/idp/options');
  canReset.value = options.ok && options.body.mail === true;
  canSignUp.value =
    options.ok && options.body.signup !== undefined && options.body.signup !== 'closed';
  providers.value = options.ok ? (options.body.providers ?? []) : [];
  if (link.value && uid.value) {
    const pending = await call<{ label: string; email: string }>(
      `/idp/upstream/pending/${link.value}?uid=${uid.value}`,
    );
    if (pending.ok) {
      pendingLabel.value = pending.body.label;
      pendingEmail.value = pending.body.email;
    }
  }
});

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
    const res = await post('login', {
      login: login.value,
      password: password.value,
      ...(pendingLabel.value && link.value ? { link: link.value } : {}),
    });
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
      <p v-if="error || upstreamError" class="notice error" role="alert">
        {{ error ?? upstreamError }}
      </p>
      <p v-if="pendingLabel" class="notice" role="status">
        An account with {{ pendingEmail }} already exists. Sign in to it to connect your
        {{ pendingLabel }} account; nothing is connected until you do.
      </p>
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
      <ul v-if="providers.length && !pendingLabel" class="providers">
        <li v-for="p in providers" :key="p.id">
          <a class="button" :href="`/oidc/interaction/${uid}/upstream/${p.id}`"
            >Sign in with {{ p.label }}</a
          >
        </li>
      </ul>
      <p v-if="canSignUp">
        <NuxtLink to="/account/signup" target="_blank">Create an account</NuxtLink>
      </p>
      <p v-if="canReset">
        <NuxtLink to="/account/forgot" target="_blank">Forgot your password?</NuxtLink>
      </p>
    </form>
  </section>
</template>
