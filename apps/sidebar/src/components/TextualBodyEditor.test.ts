import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TextualBodyEditor from './TextualBodyEditor.vue';

describe('TextualBodyEditor', () => {
  it('emits the comment text as it is typed', async () => {
    const wrapper = mount(TextualBodyEditor, { props: { modelValue: '', tags: [] } });
    await wrapper.find('textarea').setValue('A note');
    expect(wrapper.emitted('update:modelValue')).toEqual([['A note']]);
  });

  it('adds tags on Enter and comma, ignores duplicates, and removes them', async () => {
    const wrapper = mount(TextualBodyEditor, { props: { modelValue: '', tags: ['one'] } });
    const input = wrapper.find('input[name="tag"]');
    await input.setValue('two, one');
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:tags')?.at(-1)).toEqual([['one', 'two']]);

    await wrapper.find('button[aria-label="Remove tag one"]').trigger('click');
    expect(wrapper.emitted('update:tags')?.at(-1)).toEqual([[]]);
  });
});
