import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TextualBodyEditor from './TextualBodyEditor.vue';

describe('TextualBodyEditor', () => {
  it('emits the comment text as it is typed', async () => {
    const wrapper = mount(TextualBodyEditor, { props: { modelValue: '', tags: [] } });
    await wrapper.find('textarea').setValue('A note');
    expect(wrapper.emitted('update:modelValue')).toEqual([['A note']]);
  });

  it('adds tags on Enter and a typed comma, trimmed, ignores duplicates, and removes them', async () => {
    const wrapper = mount(TextualBodyEditor, { props: { modelValue: '', tags: ['one'] } });
    const input = wrapper.find('input[name="tag"]');
    const last = () => wrapper.emitted('update:tags')?.at(-1);
    await input.setValue(' two ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(last()).toEqual([['one', 'two']]);
    expect((input.element as HTMLInputElement).value).toBe('');

    (input.element as HTMLInputElement).value = 'three,';
    await input.trigger('input', { data: ',' });
    expect(last()).toEqual([['one', 'two', 'three']]);

    await input.setValue('one');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('update:tags')).toHaveLength(2);

    // The tag's button is named by the tag's text.
    const tag = wrapper.find('.tag');
    expect(tag.find('button').attributes('aria-labelledby')).toBe(
      tag.find('span').attributes('id'),
    );
    await tag.find('button').trigger('click');
    expect(last()).toEqual([['two', 'three']]);
  });
});
