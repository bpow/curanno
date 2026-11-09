<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from '#imports';
import { call } from '../account/http';
import { useAuth } from '../composables/auth';

// The password and addresses of a user of the embedded issuer (ADR 0028).
const auth = useAuth();
const route = useRoute();
const LINK_ERRORS: Record<string, string> = {
  owned: 'That account is already connected to someone else.',
  browser: 'That was started in another browser. Try again here.',
  expired: 'That took too long or was already used. Try again.',
  denied: 'The connection was cancelled.',
  failed: 'The other service could not confirm who you are. Try again.',
};

interface Account {
  login: string | null;
  emails: { email: string; verified: boolean; primary: boolean }[];
  mail: boolean;
  links: { provider: string; label: string; email?: string }[];
  providers: { id: string; label: string }[];
}
const account = ref<Account>();
const current = ref('');
const next = ref('');
const newEmail = ref('');
const message = ref<{ text: string; error: boolean }>();
const busy = ref(false);
const linkPassword = ref('');

const say = (text: string, error = false): void => {
  message.value = { text, error };
};

async function load(): Promise<void> {
  const answer = await call<Account>('/auth/account', { token: auth.token() });
  if (answer.ok) account.value = answer.body;
}
onMounted(async () => {
  await load();
  const error = route.query['link_error'];
  if (typeof error === 'string') say(LINK_ERRORS[error] ?? 'The connection failed.', true);
  else if (route.query['linked']) say('Account connected.');
});

async function connect(id: string): Promise<void> {
  busy.value = true;
  const answer = await call<{ url: string }>(`/auth/links/${id}/start`, {
    body: { password: linkPassword.value },
    token: auth.token(),
  });
  if (answer.ok) {
    window.location.assign(answer.body.url);
    return;
  }
  busy.value = false;
  say(answer.message, true);
}

async function disconnect(id: string): Promise<void> {
  if (
    await act(`/auth/links/${id}/unlink`, { password: linkPassword.value }, 'Account disconnected.')
  ) {
    linkPassword.value = '';
  }
}

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

    <template v-if="account.providers.length">
      <h3>Connected accounts</h3>
      <ul v-if="account.links.length">
        <li v-for="l in account.links" :key="l.provider">
          {{ l.label }} <span v-if="l.email" class="muted">({{ l.email }})</span>
          <button type="button" class="link" :disabled="busy" @click="disconnect(l.provider)">
            Disconnect
          </button>
        </li>
      </ul>
      <p v-else class="muted">No other accounts are connected.</p>
      <label v-if="account.login" class="field">
        Your password, to connect or disconnect
        <input
          v-model="linkPassword"
          name="link-password"
          type="password"
          autocomplete="current-password"
        />
      </label>
      <p>
        <button
          v-for="p in account.providers.filter(
            (x) => !account!.links.some((l) => l.provider === x.id),
          )"
          :key="p.id"
          type="button"
          :disabled="busy"
          @click="connect(p.id)"
        >
          Connect {{ p.label }}
        </button>
      </p>
    </template>

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
