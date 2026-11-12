import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App.vue';
import { setUserManagerFactory, useAuthStore } from './auth/store';
import { installFakeApi, json, type FakeApi } from './test/fake-api';
import { fakeUser, stubUserManager } from './test/stub-user-manager';

function eventStream(): Response {
  return new Response(new ReadableStream(), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('App', () => {
  let api: FakeApi;
  beforeEach(() => {
    setActivePinia(createPinia());
    setUserManagerFactory(() => stubUserManager());
    api = installFakeApi(({ url }) => {
      if (url.pathname === '/x/profiles') return json([]);
      if (url.pathname === '/x/search') return json({ total: 0, items: [] });
      if (url.pathname === '/x/events') return eventStream();
      return undefined;
    });
  });

  it('shows public annotations and offers a login when there is no session', async () => {
    await useAuthStore().init();
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('CurAnno');
    expect(wrapper.find('.user-menu button').text()).toBe('Log in');
    expect(wrapper.text()).toContain('Log in to annotate');
    expect(wrapper.text()).toContain('No annotations on this document yet');
  });

  it('starts again with fresh searches and streams when another account signs in', async () => {
    setUserManagerFactory(() => stubUserManager(fakeUser({ sub: 'alice' })));
    const auth = useAuthStore();
    await auth.init();
    mount(App);
    await flushPromises();
    const of = (path: string) => api.calls.filter((c) => c.url.pathname === path);
    expect(of('/x/search')).toHaveLength(1);
    expect(of('/x/events')).toHaveLength(1);

    // Still signed in, but as someone else: nothing of Alice's session is kept.
    auth.user = fakeUser({ sub: 'bob', name: 'Bob' });
    await flushPromises();
    expect(of('/x/events')[0]?.signal.aborted).toBe(true);
    expect(of('/x/search')).toHaveLength(2);
    expect(of('/x/events')).toHaveLength(2);
    expect(of('/x/events')[1]?.signal.aborted).toBe(false);
  });
});
