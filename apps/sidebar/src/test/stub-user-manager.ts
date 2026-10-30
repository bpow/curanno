import type { User, UserManager } from 'oidc-client-ts';

/** A UserManager that never talks to a provider; tests hand it a user. */
export function stubUserManager(user: User | null = null): UserManager {
  const handlers: Record<string, ((...args: never[]) => void)[]> = {};
  const on = (name: string) => (cb: (...args: never[]) => void) => {
    (handlers[name] ??= []).push(cb);
    return () => undefined;
  };
  const stub = {
    events: {
      addUserLoaded: on('loaded'),
      addUserUnloaded: on('unloaded'),
      addAccessTokenExpired: on('expired'),
      addSilentRenewError: on('renewError'),
    },
    getUser: () => Promise.resolve(user),
    signinRedirect: () => Promise.resolve(),
    signinRedirectCallback: () => Promise.resolve(user),
    signinPopup: () => Promise.resolve(user),
    signoutRedirect: () => Promise.resolve(),
    signoutPopup: () => Promise.resolve(),
    removeUser: () => Promise.resolve(),
  };
  return stub as unknown as UserManager;
}

export function fakeUser(overrides: Partial<User['profile']> = {}): User {
  return {
    access_token: 'test-token',
    expired: false,
    profile: { sub: 'sub-1', name: 'Alice Annotator', preferred_username: 'alice', ...overrides },
  } as unknown as User;
}
