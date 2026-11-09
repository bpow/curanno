import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Signup from './signup.vue';

function mountSignup(): VueWrapper {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const wrapper: VueWrapper = mount(Signup);
  return wrapper;
}

const reply = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('the sign-up page', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function server(signup: string, answer: Response | undefined = undefined) {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url === '/idp/options' ? reply(200, { signup, mail: true }) : (answer ?? reply(202)),
      ),
    );
  }

  it('says accounts are by invitation when sign-up is closed, without a form', async () => {
    server('closed');
    const wrapper = mountSignup();
    await flushPromises();
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('by invitation');
  });

  it('asks why under approval and says the application waits once sent', async () => {
    server('approval', reply(202, { status: 'pending' }));
    const wrapper = mountSignup();
    await flushPromises();
    expect(wrapper.find('textarea[name=note]').exists()).toBe(true);
    await wrapper.find('input[name=name]').setValue('Ann');
    await wrapper.find('input[name=email]').setValue('ann@example.org');
    await wrapper.find('input[name=password]').setValue('a long enough password');
    await wrapper.find('textarea[name=note]').setValue('Reviewing the corpus');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const sent = fetchMock.mock.calls.find(([url]) => url === '/idp/signup');
    expect(JSON.parse(sent?.[1]?.body as string)).toEqual({
      email: 'ann@example.org',
      password: 'a long enough password',
      displayName: 'Ann',
      note: 'Reviewing the corpus',
    });
    expect(wrapper.find('[role=status]').text()).toContain('waiting for an administrator');
  });

  it('does not ask for a reason under open sign-up, and shows the refusal it is given', async () => {
    server('open', reply(429, { detail: 'Too many attempts.' }));
    const wrapper = mountSignup();
    await flushPromises();
    expect(wrapper.find('textarea[name=note]').exists()).toBe(false);
    await wrapper.find('input[name=name]').setValue('Ann');
    await wrapper.find('input[name=email]').setValue('ann@example.org');
    await wrapper.find('input[name=password]').setValue('a long enough password');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toContain('Too many attempts');
  });
});
