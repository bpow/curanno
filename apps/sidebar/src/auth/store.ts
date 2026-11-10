import type { User, UserManager } from 'oidc-client-ts';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { appBaseUrl, createUserManager, isFramed } from './user-manager';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface SigninState {
  returnTo?: string;
}

let managerFactory: () => UserManager = createUserManager;

/** Tests swap the user manager for a stub. */
export function setUserManagerFactory(factory: () => UserManager): void {
  managerFactory = factory;
}

export const useAuthStore = defineStore('auth', () => {
  const manager = shallowRef<UserManager>();
  const user = shallowRef<User | null>(null);
  const status = ref<AuthStatus>('loading');
  const error = ref<string>();

  const displayName = computed(
    () =>
      user.value?.profile.name ?? user.value?.profile.preferred_username ?? user.value?.profile.sub,
  );
  const subject = computed(() => user.value?.profile.sub);

  /** The bearer token for API calls, or undefined when anonymous or expired. */
  function token(): string | undefined {
    const u = user.value;
    return u && !u.expired ? u.access_token : undefined;
  }

  function setUser(next: User | null): void {
    user.value = next && !next.expired ? next : null;
    status.value = user.value ? 'authenticated' : 'anonymous';
  }

  function getManager(): UserManager {
    if (!manager.value) {
      const m = managerFactory();
      m.events.addUserLoaded((u) => setUser(u));
      m.events.addUserUnloaded(() => setUser(null));
      m.events.addAccessTokenExpired(() => setUser(null));
      m.events.addSilentRenewError((err) => {
        error.value = `Session renewal failed: ${err.message}`;
      });
      manager.value = m;
    }
    return manager.value;
  }

  /**
   * Completes a redirect sign-in when the URL carries the provider's
   * response, otherwise restores the session from storage. With nothing
   * stored, a silent sign-in runs in the background so a new tab picks up a
   * live provider session without a click (ADR 0019); the sidebar is usable
   * anonymously meanwhile.
   */
  async function init(): Promise<void> {
    const m = getManager();
    const params = new URLSearchParams(window.location.search);
    try {
      if (params.has('state') && (params.has('code') || params.has('error'))) {
        const signedIn = await m.signinRedirectCallback();
        const state = signedIn.state as SigninState | undefined;
        window.history.replaceState(null, '', appBaseUrl() + (state?.returnTo ?? ''));
        setUser(signedIn);
        return;
      }
      const stored = await m.getUser();
      setUser(stored);
      if (!user.value) void trySilentSignin(m);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      status.value = 'anonymous';
    }
  }

  async function trySilentSignin(m: UserManager): Promise<void> {
    try {
      const signedIn = await m.signinSilent();
      // A sign-in or sign-out by the user while this ran takes precedence.
      if (status.value === 'anonymous') setUser(signedIn);
    } catch {
      // login_required, blocked third-party cookies or a timeout: stay anonymous.
    }
  }

  async function login(): Promise<void> {
    const m = getManager();
    error.value = undefined;
    try {
      if (isFramed()) {
        setUser(await m.signinPopup());
      } else {
        const state: SigninState = { returnTo: window.location.search };
        await m.signinRedirect({ state });
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function logout(): Promise<void> {
    const m = getManager();
    error.value = undefined;
    try {
      if (isFramed()) {
        await m.signoutPopup();
      } else {
        // Back to the same document afterwards; the base URL with any query
        // is within the registered redirect URIs.
        await m.signoutRedirect({
          post_logout_redirect_uri: appBaseUrl() + window.location.search,
        });
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      // Whatever the provider did, this origin forgets the tokens.
      await m.removeUser();
      setUser(null);
    }
  }

  return { user, status, error, displayName, subject, token, init, login, logout };
});
