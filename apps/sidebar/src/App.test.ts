import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App.vue';
import { setUserManagerFactory } from './auth/store';
import { installFakeApi, json } from './test/fake-api';
import { stubUserManager } from './test/stub-user-manager';

describe('App', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setUserManagerFactory(() => stubUserManager());
    installFakeApi(({ url }) => {
      if (url.pathname === '/x/profiles') return json([]);
      if (url.pathname === '/x/search') return json({ total: 0, items: [] });
      return undefined;
    });
  });

  it('shows public annotations and offers a login when there is no session', async () => {
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('Annotations');
    expect(wrapper.find('header button').text()).toBe('Log in');
    expect(wrapper.text()).toContain('Log in to annotate');
    expect(wrapper.text()).toContain('No annotations on this document yet');
  });
});
