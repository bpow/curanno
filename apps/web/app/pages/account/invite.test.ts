import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRouteQuery } from '../../test/nuxt-imports';
import Invite from './invite.vue';

vi.mock('../../composables/auth', () => ({ useAuth: () => ({ login: vi.fn() }) }));

const TOKEN = 'abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEF';

function mountInvite(): VueWrapper {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const wrapper: VueWrapper = mount(Invite);
  return wrapper;
}

function reply(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('the invitation page', () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setRouteQuery({ token: TOKEN });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the invited address and creates the account with the chosen password', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url === '/auth/invite/peek' ? reply(200, { email: 'new@example.org' }) : reply(201),
      ),
    );
    const wrapper = mountInvite();
    await flushPromises();
    expect(wrapper.text()).toContain('new@example.org');
    await wrapper.find('input[name=name]').setValue('New Person');
    await wrapper.find('input[name=password]').setValue('a long enough password');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const accept = fetchMock.mock.calls.find(([url]) => url === '/auth/invite/accept');
    expect(JSON.parse(accept?.[1].body as string)).toEqual({
      token: TOKEN,
      password: 'a long enough password',
      displayName: 'New Person',
    });
    expect(wrapper.find('[role=status]').text()).toContain('ready');
  });

  it('shows the reason the server gives when the password is refused', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url === '/auth/invite/peek'
          ? reply(200, { email: 'new@example.org' })
          : reply(400, { detail: 'The password must have at least 10 characters' }),
      ),
    );
    const wrapper = mountInvite();
    await flushPromises();
    await wrapper.find('input[name=password]').setValue('short');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toContain('at least 10 characters');
  });

  it('says the invitation is no good when the server does not know it, or the link is malformed', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(reply(400, { detail: 'This link has expired' })),
    );
    let wrapper = mountInvite();
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toContain('expired');
    expect(wrapper.find('form').exists()).toBe(false);
    fetchMock.mockReset();
    setRouteQuery({ token: 'short' });
    wrapper = mountInvite();
    await flushPromises();
    expect(wrapper.find('[role=alert]').exists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
