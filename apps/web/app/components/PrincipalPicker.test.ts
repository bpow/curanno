import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { API_KEY } from '../api/client';
import { fakeApi, json, problem, type Route } from '../test/fake-api';
import PrincipalPicker from './PrincipalPicker.vue';

/** Lets the search's debounce run out. */
const debounced = () => new Promise((resolve) => setTimeout(resolve, 250));

function mountPicker(route: Route) {
  const api = fakeApi(route);
  return mount(PrincipalPicker, {
    props: {
      label: 'Add member',
      placeholder: '',
      noMatch: 'No users match.',
      offer: () => true,
      add: () => Promise.resolve(true),
    },
    global: { provide: { [API_KEY as symbol]: api.client } },
  });
}

describe('PrincipalPicker', () => {
  it('searches once typing pauses, not on every keystroke', async () => {
    const api = fakeApi(() => json([]));
    const wrapper = mount(PrincipalPicker, {
      props: {
        label: 'Add member',
        placeholder: '',
        noMatch: 'No users match.',
        offer: () => true,
        add: () => Promise.resolve(true),
      },
      global: { provide: { [API_KEY as symbol]: api.client } },
    });
    const input = wrapper.find('input');
    for (const text of ['b', 'bo', 'bob']) await input.setValue(text);
    expect(wrapper.text()).not.toContain('No users match.');
    await debounced();
    await flushPromises();
    expect(api.calls.map((c) => c.url.searchParams.get('q'))).toEqual(['bob']);
    expect(wrapper.text()).toContain('No users match.');
  });

  it('says a search failed rather than that nothing matched', async () => {
    const offline = mountPicker(() => {
      throw new TypeError('Failed to fetch');
    });
    await offline.find('input').setValue('bob');
    await debounced();
    await flushPromises();
    expect(offline.text()).toContain('The search failed');
    expect(offline.text()).not.toContain('No users match.');

    const refused = mountPicker(() => problem(503, 'Service Unavailable'));
    await refused.find('input').setValue('bob');
    await debounced();
    await flushPromises();
    expect(refused.text()).toContain('The search failed');

    await refused.find('input').setValue('');
    await flushPromises();
    expect(refused.text()).not.toContain('The search failed');
  });
});
