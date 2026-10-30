import { PROFILE_BASE, evidenceExcerptProfile } from '@curanno/model';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProfilesStore } from '../stores/profiles';
import { installFakeApi, json } from '../test/fake-api';
import AnnotationEditor from './AnnotationEditor.vue';

const profileIri = `${PROFILE_BASE}evidence-excerpt/1`;

describe('AnnotationEditor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    installFakeApi(({ url }) =>
      url.pathname === '/x/profiles'
        ? json([{ ...evidenceExcerptProfile, builtin: true, enabled: true }])
        : undefined,
    );
    await useProfilesStore().load();
  });

  it('emits the draft with text and tags', async () => {
    const wrapper = mount(AnnotationEditor, { props: { draft: { text: '', tags: ['t'] } } });
    await wrapper.find('textarea[name="text"]').setValue('Hello');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('save')).toEqual([[{ text: 'Hello', tags: ['t'] }]]);
  });

  it('validates a structured body against the profile before saving', async () => {
    const wrapper = mount(AnnotationEditor, { props: { draft: { text: '', tags: [] } } });
    await wrapper.find('select[name="profile"]').setValue(profileIri);
    await wrapper.find('select[name="kind"]').setValue('case');
    await wrapper.find('input[name="identifiers"]').setValue('not a curie');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.text()).toContain('must match pattern');

    await wrapper.find('input[name="identifiers"]').setValue('PMID:12345');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('save')).toEqual([
      [
        {
          text: '',
          tags: [],
          structured: { profile: profileIri, value: { kind: 'case', identifiers: ['PMID:12345'] } },
        },
      ],
    ]);
  });

  it('shows a conflict notice for a 412 and asks to reload', async () => {
    const wrapper = mount(AnnotationEditor, {
      props: {
        draft: { text: 'x', tags: [] },
        problem: { status: 412, title: 'Precondition Failed' },
      },
    });
    expect(wrapper.text()).toContain('Someone else changed this annotation');
    await wrapper.find('button.link').trigger('click');
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });
});
