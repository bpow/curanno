<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { call } from '../account/http';
import { useAuth } from '../composables/auth';

// The password and addresses of a user of the embedded issuer (ADR 0028).
const auth = useAuth();

interface Account {
  login: string | null;
  emails: { email: string; verified: boolean; primary: boolean }[];
  mail: boolean;
}
const account = ref<Account>();
const current = ref('');
const next = ref('');
const newEmail = ref('');
const message = ref<{ text: string; error: boolean }>();
const busy = ref(false);

const say = (text: string, error = false): void => {
  message.value = { text, error };
};

async function load(): Promise<void> {
  const answer = await call<Account>('/auth/account', { token: auth.token() });
  if (answer.ok) account.value = answer.body;
}
onMounted(load);

async function act(path: string, body: object, success: string): Promise<boolean> {
  busy.value = true;
  const answer = await call(path, { body, token: auth.token() });
  busy.value = false;
  if (!answer.ok) {
    say(answer.message, true);
    return false;
  }
  say(success);
  await load();
  return true;
}

async function changePassword(): Promise<void> {
  if (
    await act('/auth/password', { current: current.value, next: next.value }, 'Password changed.')
  ) {
    current.value = '';
    next.value = '';
  }
}

async function addEmail(): Promise<void> {
  if (
    await act(
      '/auth/emails',
      { email: newEmail.value },
      'If that address is free, a message with a link to verify it is on its way.',
    )
  ) {
    newEmail.value = '';
  }
}
</script>

<template>
  <section v-if="account" class="account-settings">
    <h2>Sign-in</h2>
    <p
      v-if="message"
      :class="['notice', { error: message.error }]"
      :role="message.error ? 'alert' : 'status'"
    >
      {{ message.text }}
    </p>
    <p v-if="account.login">
      Your login is <strong>{{ account.login }}</strong
      >.
    </p>

    <form v-if="account.login" @submit.prevent="changePassword">
      <h3>Change password</h3>
      <label class="field">
        Current password
        <input
          v-model="current"
          name="current"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <label class="field">
        New password (at least 10 characters)
        <input
          v-model="next"
          name="next"
          type="password"
          autocomplete="new-password"
          minlength="10"
          required
        />
      </label>
      <button type="submit" :disabled="busy">Change password</button>
    </form>

    <h3>Email addresses</h3>
    <ul v-if="account.emails.length">
      <li v-for="e in account.emails" :key="e.email">
        {{ e.email }}
        <span class="muted">{{
          e.primary ? '(primary)' : e.verified ? '(verified)' : '(not verified)'
        }}</span>
        <button
          v-if="e.verified && !e.primary"
          type="button"
          class="link"
          :disabled="busy"
          @click="act('/auth/emails/primary', { email: e.email }, 'Primary address changed.')"
        >
          Make primary
        </button>
        <button
          v-if="!e.primary"
          type="button"
          class="link"
          :disabled="busy"
          @click="act('/auth/emails/remove', { email: e.email }, 'Address removed.')"
        >
          Remove
        </button>
      </li>
    </ul>
    <p v-else class="muted">No addresses yet.</p>
    <form v-if="account.mail" @submit.prevent="addEmail">
      <label class="field">
        Add an address
        <input v-model="newEmail" name="new-email" type="email" autocomplete="email" required />
      </label>
      <button type="submit" :disabled="busy">Send a verification link</button>
    </form>
    <p v-else class="muted">This server cannot send mail, so addresses cannot be added.</p>
  </section>
</template>
