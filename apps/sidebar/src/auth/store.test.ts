import { flushPromises } from '@vue/test-utils';
import type { UserManager } from 'oidc-client-ts';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser, stubUserManager } from '../test/stub-user-manager';
import { setUserManagerFactory, useAuthStore } from './store';

const env = vi.hoisted(() => ({ framed: false, extension: undefined as string | undefined }));
vi.mock('./extension', () => ({
  listenForExtension: () => undefined,
  extensionRedirectUri: () => env.extension,
}));
vi.mock('./user-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./user-manager')>()),
  isFramed: () => env.framed,
}));

const EXTENSION_URI = 'https://dmlkjhnoiinndnkboiknehimngilddpp.chromiumapp.org/';

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    env.framed = false;
    env.extension = undefined;
  });

  it('picks up a live provider session silently when nothing is stored', async () => {
    let finish!: (u: ReturnType<typeof fakeUser>) => void;
    setUserManagerFactory(
      () =>
        ({
          ...stubUserManager(),
          signinSilent: () => new Promise((resolve) => (finish = resolve)),
        }) as unknown as UserManager,
    );
    const auth = useAuthStore();
    await auth.init();
    expect(auth.status).toBe('anonymous');

    finish(fakeUser({ sub: 'alice' }));
    await flushPromises();
    expect(auth.status).toBe('authenticated');
    expect(auth.subject).toBe('alice');
  });

  it('stays anonymous without an error when the provider needs a login', async () => {
    setUserManagerFactory(() => stubUserManager());
    const auth = useAuthStore();
    await auth.init();
    await flushPromises();
    expect(auth.status).toBe('anonymous');
    expect(auth.error).toBeUndefined();
  });

  it('signs in and out through the extension when its bridge is in the frame', async () => {
    env.framed = true;
    env.extension = EXTENSION_URI;
    const alice = fakeUser({ sub: 'alice' });
    let stored: ReturnType<typeof fakeUser> | null = null;
    const calls: string[] = [];
    setUserManagerFactory((redirectUri) => {
      if (!redirectUri) {
        return {
          ...stubUserManager(),
          getUser: () => Promise.resolve(stored),
          signinPopup: () => Promise.reject(new Error('the main manager opened a popup')),
          signoutPopup: () => Promise.reject(new Error('the main manager opened a popup')),
          removeUser: () => {
            calls.push('removeUser');
            return Promise.resolve();
          },
        } as unknown as UserManager;
      }
      expect(redirectUri).toBe(EXTENSION_URI);
      return {
        ...stubUserManager(),
        signinPopup: () => {
          calls.push('extension signin');
          stored = alice;
          return Promise.resolve(alice);
        },
        signoutPopup: () => {
          calls.push('extension signout');
          return Promise.resolve();
        },
      } as unknown as UserManager;
    });
    const auth = useAuthStore();
    await auth.init();
    await auth.login();
    expect(auth.error).toBeUndefined();
    expect(auth.subject).toBe('alice');

    await auth.logout();
    expect(auth.status).toBe('anonymous');
    expect(calls).toEqual(['extension signin', 'extension signout', 'removeUser']);
  });

  it('explains a sign-in window that the page cut off', async () => {
    env.framed = true;
    setUserManagerFactory(
      () =>
        ({
          ...stubUserManager(),
          signinPopup: () =>
            Promise.reject(new Error('Attempted to navigate on a disposed window')),
        }) as unknown as UserManager,
    );
    const auth = useAuthStore();
    await auth.init();
    await auth.login();
    expect(auth.error).toMatch(/blocks the sign-in window/);
    expect(auth.status).toBe('anonymous');
  });
});
