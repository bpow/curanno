import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import AccountStatusBanner from './AccountStatusBanner.vue';

const me = ref<{ status: string } | null>(null);
vi.mock('../composables/auth', () => ({ useAuth: () => ({ me }) }));

function banner(): VueWrapper {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const wrapper: VueWrapper = mount(AccountStatusBanner);
  return wrapper;
}

describe('the account status banner', () => {
  it('says nothing to an active or signed-out user', () => {
    me.value = null;
    expect(banner().text()).toBe('');
    me.value = { status: 'active' };
    expect(banner().text()).toBe('');
  });

  it('explains a pending, rejected or disabled account', () => {
    me.value = { status: 'pending' };
    expect(banner().text()).toContain('waiting for approval');
    me.value = { status: 'rejected' };
    expect(banner().text()).toContain('not approved');
    me.value = { status: 'disabled' };
    expect(banner().text()).toContain('disabled');
  });
});
