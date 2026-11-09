import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRouteQuery } from '../../test/nuxt-imports';
import Login from './login.vue';

const UID = 'abc-DEF_123';

/** `mount` is typed `any` for components from .vue files; the tests use it as a plain wrapper. */
function mountLogin(): VueWrapper {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const wrapper: VueWrapper = mount(Login);
  return wrapper;
}

function reply(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('the sign-in page of the embedded issuer', () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  const assign = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    assign.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { origin: window.location.origin, assign });
    setRouteQuery({ uid: UID });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The calls to the interaction, apart from the page asking the server what it can do. */
  const interactionCalls = () => fetchMock.mock.calls.filter(([url]) => url.startsWith('/oidc/'));

  async function fill(wrapper: VueWrapper, login: string, password: string) {
    await wrapper.find('input[name=login]').setValue(login);
    await wrapper.find('input[name=password]').setValue(password);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
  }

  it('labels its fields and asks the browser to remember the login', () => {
    const wrapper = mountLogin();
    expect(wrapper.find('h1').text()).toBe('Sign in');
    expect(wrapper.text()).toContain('Email or user name');
    expect(wrapper.find('input[name=login]').attributes('autocomplete')).toBe('username');
    expect(wrapper.find('input[name=password]').attributes('autocomplete')).toBe(
      'current-password',
    );
    expect(wrapper.find('input[name=password]').attributes('type')).toBe('password');
  });

  it('posts the credentials to the interaction it was given and resumes the flow', async () => {
    const resume = `${window.location.origin}/oidc/auth/${UID}`;
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { redirectTo: resume })));
    const wrapper = mountLogin();
    await fill(wrapper, 'alice@example.org', 'a long password');
    expect(interactionCalls()).toHaveLength(1);
    const [url, init] = interactionCalls()[0] ?? [];
    expect(url).toBe(`/oidc/interaction/${UID}/login`);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(init?.body as string)).toEqual({
      login: 'alice@example.org',
      password: 'a long password',
    });
    expect(assign).toHaveBeenCalledWith(resume);
  });

  it('says so when the login or password is wrong, and clears the password', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(401, { title: 'Unauthorized' })));
    const wrapper = mountLogin();
    await fill(wrapper, 'alice@example.org', 'nope');
    expect(wrapper.find('[role=alert]').text()).toContain('not right');
    expect((wrapper.find('input[name=password]').element as HTMLInputElement).value).toBe('');
    expect(assign).not.toHaveBeenCalled();
  });

  it('tells the user to start again when the sign-in has expired', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(400, { title: 'Bad Request' })));
    const wrapper = mountLogin();
    await fill(wrapper, 'alice@example.org', 'a long password');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('[role=alert]').text()).toContain('expired');
  });

  it('does not follow an address on another origin', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(reply(200, { redirectTo: 'https://evil.example/oidc/auth/x' })),
    );
    const wrapper = mountLogin();
    await fill(wrapper, 'alice@example.org', 'a long password');
    expect(assign).not.toHaveBeenCalled();
    expect(wrapper.find('[role=alert]').exists()).toBe(true);
  });

  it('cancels through the interaction, which sends the user back to the application', async () => {
    const back = `${window.location.origin}/oidc/auth/${UID}`;
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { redirectTo: back })));
    const wrapper = mountLogin();
    await wrapper.find('button[type=button]').trigger('click');
    await flushPromises();
    expect(interactionCalls()[0]?.[0]).toBe(`/oidc/interaction/${UID}/abort`);
    expect(assign).toHaveBeenCalledWith(back);
  });

  it('shows no form without a usable interaction id, and never calls the server', () => {
    for (const query of [{}, { uid: '../../x' }, { uid: 'a b' }]) {
      setRouteQuery(query);
      const wrapper = mountLogin();
      expect(wrapper.find('form').exists()).toBe(false);
      expect(wrapper.find('[role=alert]').exists()).toBe(true);
    }
    expect(interactionCalls()).toEqual([]);
  });

  it('offers a password reset only when the server can send mail', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { mail: false })));
    let wrapper = mountLogin();
    await flushPromises();
    expect(wrapper.text()).not.toContain('Forgot your password');
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { mail: true })));
    wrapper = mountLogin();
    await flushPromises();
    expect(wrapper.text()).toContain('Forgot your password');
  });

  it('offers the configured providers, as links into the interaction', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        reply(200, {
          providers: [
            { id: 'google', label: 'Google' },
            { id: 'github', label: 'GitHub' },
          ],
        }),
      ),
    );
    const wrapper = mountLogin();
    await flushPromises();
    const hrefs = wrapper.findAll('a.button').map((a) => a.attributes('href'));
    expect(hrefs).toEqual([
      `/oidc/interaction/${UID}/upstream/google`,
      `/oidc/interaction/${UID}/upstream/github`,
    ]);
  });

  it('explains what went wrong at a provider in words', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, {})));
    setRouteQuery({ uid: UID, error: 'use-existing' });
    const wrapper = mountLogin();
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toContain('no password');
    setRouteQuery({ uid: UID, error: 'nonsense' });
    expect(mountLogin().find('[role=alert]').exists()).toBe(false);
  });

  it('says what a pending link would connect, hides the providers, and sends the link with the password', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url.startsWith('/idp/upstream/pending/')
          ? reply(200, { label: 'Google', email: 'owner@example.org' })
          : url === '/idp/options'
            ? reply(200, { providers: [{ id: 'google', label: 'Google' }] })
            : reply(200, { redirectTo: `${window.location.origin}/oidc/auth/${UID}` }),
      ),
    );
    setRouteQuery({ uid: UID, link: 'abc123' });
    const wrapper = mountLogin();
    await flushPromises();
    expect(wrapper.find('[role=status]').text()).toContain('owner@example.org');
    expect(wrapper.find('a.button').exists()).toBe(false);
    await fill(wrapper, 'owner@example.org', 'a long password');
    const posted = interactionCalls()[0]?.[1];
    expect(JSON.parse(posted?.body as string)).toEqual({
      login: 'owner@example.org',
      password: 'a long password',
      link: 'abc123',
    });
  });
});
