import { evidenceExcerptProfile } from '@curanno/model';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import StructuredBodyEditor from './StructuredBodyEditor.vue';

describe('StructuredBodyEditor', () => {
  it('builds fields from the profile schema', () => {
    const wrapper = mount(StructuredBodyEditor, {
      props: { profile: evidenceExcerptProfile, modelValue: {} },
    });
    const kind = wrapper.find('select[name="kind"]');
    expect(kind.exists()).toBe(true);
    expect(kind.attributes('required')).toBeDefined();
    expect(kind.findAll('option').map((o) => o.text())).toEqual([
      '—',
      'case',
      'functional',
      'segregation',
      'population',
      'computational',
      'other',
    ]);
    expect(wrapper.find('textarea[name="summary"]').exists()).toBe(true);
    expect(wrapper.find('select[name="confidence"]').exists()).toBe(true);
    expect(wrapper.find('input[name="identifiers"]').exists()).toBe(true);
  });

  it('emits the value with enum, list and text fields set and empty ones dropped', async () => {
    const wrapper = mount(StructuredBodyEditor, {
      props: { profile: evidenceExcerptProfile, modelValue: { summary: 'old' } },
    });
    await wrapper.find('select[name="kind"]').setValue('case');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { summary: 'old', kind: 'case' },
    ]);

    await wrapper.setProps({ modelValue: { summary: 'old', kind: 'case' } });
    await wrapper.find('input[name="identifiers"]').setValue('PMID:1, HGNC:2');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { summary: 'old', kind: 'case', identifiers: ['PMID:1', 'HGNC:2'] },
    ]);

    await wrapper.setProps({ modelValue: { summary: 'old', kind: 'case' } });
    await wrapper.find('textarea[name="summary"]').setValue('');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ kind: 'case' }]);
  });

  it('shows validation errors under the field they point at', () => {
    const wrapper = mount(StructuredBodyEditor, {
      props: {
        profile: evidenceExcerptProfile,
        modelValue: { kind: 'case', identifiers: ['bad'] },
        errors: [
          { instancePath: '/value/identifiers/0', message: 'must match pattern' },
          { instancePath: '/value', message: 'must have required property kind' },
        ],
      },
    });
    const errors = wrapper.findAll('.error').map((e) => e.text());
    expect(errors).toEqual(['must match pattern', 'must have required property kind']);
    const identifiers = wrapper
      .findAll('.field')
      .find((f) => f.find('[name="identifiers"]').exists());
    expect(identifiers?.text()).toContain('must match pattern');
  });
});
