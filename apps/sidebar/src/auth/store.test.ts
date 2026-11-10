import { flushPromises } from '@vue/test-utils';
import type { UserManager } from 'oidc-client-ts';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser, stubUserManager } from '../test/stub-user-manager';
import { setUserManagerFactory, useAuthStore } from './store';

const env = vi.hoisted(() => ({ framed: false }));
vi.mock('./user-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./user-manager')>()),
  isFramed: () => env.framed,
}));

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    env.framed = false;
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
