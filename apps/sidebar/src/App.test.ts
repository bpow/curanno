import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App.vue';
import { setUserManagerFactory } from './auth/store';
import { stubUserManager } from './test/stub-user-manager';

describe('App', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setUserManagerFactory(() => stubUserManager());
  });

  it('offers a login when there is no session', async () => {
    const wrapper = mount(App);
    await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.find('h1').text()).toBe('Annotations');
    expect(wrapper.find('button').text()).toBe('Log in');
  });
});
