import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi, json } from '../test/fake-api';
import AclEditor from './AclEditor.vue';

describe('AclEditor', () => {
  afterEach(() => vi.useRealTimers());

  it('stops showing a search as running once the query is cleared', async () => {
    vi.useFakeTimers();
    let answer: (response: Response) => void = () => undefined;
    installFakeApi(({ url }) =>
      url.pathname === '/x/principals'
        ? new Promise<Response>((resolve) => (answer = resolve))
        : undefined,
    );
    const wrapper = mount(AclEditor, { props: { entries: [] } });
    const input = wrapper.find('input[name="principal"]');

    await input.setValue('bo');
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.text()).toContain('Searching…');

    await input.setValue('');
    answer(json([]));
    await flushPromises();
    expect(wrapper.text()).not.toContain('Searching…');
  });
});
