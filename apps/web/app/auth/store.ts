import type { ApiClient, User as ApiUser } from '@scale/api-client';
import type { User, UserManager } from 'oidc-client-ts';
import { computed, ref, shallowRef } from 'vue';
import { toProblem, unwrap } from '../api/problems';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface SigninState {
  returnTo?: string;
}

/** Only paths on this site are followed after sign-in, never another origin. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

export function createAuthStore(manager: UserManager) {
  const user = shallowRef<User | null>(null);
  /** The caller as the API sees them, from `/x/me`; carries `isAdmin`. */
  const me = shallowRef<ApiUser | null>(null);
  const status = ref<AuthStatus>('loading');
  const error = ref<string>();
  let api: ApiClient | undefined;
  let ready: Promise<void> = Promise.resolve();

  const displayName = computed(
    () =>
      me.value?.displayName ??
      user.value?.profile.name ??
      user.value?.profile.preferred_username ??
      user.value?.profile.sub,
  );
  const isAdmin = computed(() => me.value?.isAdmin === true);

  /** The bearer token for API calls, or undefined when anonymous or expired. */
  function token(): string | undefined {
    const u = user.value;
    return u && !u.expired ? u.access_token : undefined;
  }

  async function loadMe(): Promise<void> {
    if (!api || !token()) {
      me.value = null;
      return;
    }
    try {
      me.value = unwrap(await api.GET('/x/me'));
    } catch (err) {
      me.value = null;
      error.value = `Could not load your account: ${toProblem(err).detail ?? toProblem(err).title}`;
    }
  }

  async function setUser(next: User | null): Promise<void> {
    user.value = next && !next.expired ? next : null;
    status.value = user.value ? 'authenticated' : 'anonymous';
    await loadMe();
  }

  manager.events.addUserLoaded((u) => void setUser(u));
  manager.events.addUserUnloaded(() => void setUser(null));
  manager.events.addAccessTokenExpired(() => void setUser(null));
  manager.events.addSilentRenewError((err) => {
    error.value = `Session renewal failed: ${err.message}`;
  });

  /** Restores the session from storage; `ready()` resolves once that is known. */
  function init(client: ApiClient): Promise<void> {
    api = client;
    ready = (async () => {
      try {
        await setUser(await manager.getUser());
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        status.value = 'anonymous';
      }
    })();
    return ready;
  }

  async function login(returnTo: string): Promise<void> {
    error.value = undefined;
    const state: SigninState = { returnTo: safeReturnTo(returnTo) };
    await manager.signinRedirect({ state });
  }

  /** Finishes a redirect sign-in on the callback page; returns where to go next. */
  async function completeLogin(): Promise<string> {
    const signedIn = await manager.signinRedirectCallback();
    await setUser(signedIn);
    return safeReturnTo((signedIn.state as SigninState | undefined)?.returnTo);
  }

  async function logout(): Promise<void> {
    error.value = undefined;
    try {
      await manager.signoutRedirect();
    } finally {
      // Whatever the provider did, this origin forgets the tokens.
      await manager.removeUser();
      await setUser(null);
    }
  }

  return {
    user,
    me,
    status,
    error,
    displayName,
    isAdmin,
    token,
    init,
    ready: () => ready,
    login,
    completeLogin,
    logout,
    reloadMe: loadMe,
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;
