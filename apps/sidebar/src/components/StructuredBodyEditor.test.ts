import { caseIndividualProfile, evidenceExcerptProfile, type BodyProfile } from '@curanno/model';
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

  describe('object lists', () => {
    const profile: BodyProfile = {
      iri: 'https://curanno.example/profiles/test-list/1',
      title: 'List test',
      schema: {
        type: 'object',
        required: ['variants'],
        properties: {
          variants: {
            title: 'Variants',
            type: 'array',
            minItems: 1,
            items: {
              title: 'Variant',
              type: 'object',
              required: ['variant'],
              properties: { gene: { type: 'string' }, variant: { type: 'string' } },
            },
          },
        },
      },
    };

    it('adds, edits and removes items', async () => {
      const wrapper = mount(StructuredBodyEditor, { props: { profile, modelValue: {} } });
      await wrapper.find('button:not(.link)').trigger('click');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ variants: [{}] }]);

      await wrapper.setProps({ modelValue: { variants: [{ gene: 'MYH7' }, {}] } });
      expect(wrapper.find<HTMLTextAreaElement>('[name="variants.0.gene"]').element.value).toBe(
        'MYH7',
      );
      await wrapper.find('[name="variants.1.variant"]').setValue('c.1208G>A');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
        { variants: [{ gene: 'MYH7' }, { variant: 'c.1208G>A' }] },
      ]);

      await wrapper.find('button.link').trigger('click');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ variants: [{}] }]);

      await wrapper.setProps({ modelValue: { variants: [{}] } });
      await wrapper.find('button.link').trigger('click');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{}]);
    });

    it('shows item errors inside the item and list errors under the list', () => {
      const wrapper = mount(StructuredBodyEditor, {
        props: {
          profile,
          modelValue: { variants: [{ gene: 'MYH7' }] },
          errors: [
            { instancePath: '/value/variants/0', message: 'must have required property variant' },
            { instancePath: '/value/variants', message: 'must NOT have fewer than 1 items' },
          ],
        },
      });
      expect(wrapper.find('fieldset.item').text()).toContain('must have required property variant');
      const list = wrapper.find('fieldset.list');
      expect(list.findAll(':scope > .error').map((e) => e.text())).toEqual([
        'must NOT have fewer than 1 items',
      ]);
      expect(wrapper.findAll('.error')).toHaveLength(2);
    });
  });

  it('builds the case-individual form with a variant list', () => {
    const wrapper = mount(StructuredBodyEditor, {
      props: { profile: caseIndividualProfile, modelValue: { case: 'P1', variants: [{}] } },
    });
    expect(wrapper.find('input[name="case"]').attributes('required')).toBeDefined();
    expect(wrapper.find('textarea[name="diseaseAssertion"]').exists()).toBe(true);
    expect(wrapper.find('input[name="variants.0.variant"]').attributes('required')).toBeDefined();
    expect(wrapper.find('input[name="variants.0.clinVarId"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Add Variant');
  });
});
