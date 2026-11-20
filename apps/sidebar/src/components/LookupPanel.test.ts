import { caseVariantProfile, type JsonValue } from '@curanno/model';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeApi, json, problem, type FakeApi } from '../test/fake-api';
import StructuredBodyEditor from './StructuredBodyEditor.vue';

const individual = 'https://x.example/annotations/1';

const registryPage =
  'https://reg.clinicalgenome.org/redmine/projects/registry/genboree_registry/by_caid?caid=CA010365';

const found = {
  query: 'c.1208G>A',
  context: { gene: 'MYH7' },
  candidates: [
    {
      label: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
      fill: { caid: 'CA010365', clinVarId: '14087', gnomad: '14-23429278-C-T' },
      facts: [
        { label: 'CAID', values: [{ text: 'CA010365', url: registryPage }] },
        {
          label: 'ClinVar',
          values: [{ text: '14087', url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/14087/' }],
        },
        { label: 'gnomAD', values: [{ text: '14-23429278-C-T' }] },
      ],
      autoFill: true,
      warnings: [],
    },
  ],
  warnings: [
    {
      code: 'transcript-assumed',
      message:
        'No transcript was given, so the MANE Select transcript NM_000257.4 of MYH7 was used.',
    },
  ],
  steps: [
    { service: 'Allele Registry', request: 'NM_000257.4:c.1208G>A', outcome: 'found CA010365' },
  ],
};

function mountEditor(modelValue: JsonValue) {
  return mount(StructuredBodyEditor, { props: { profile: caseVariantProfile, modelValue } });
}

/** The value the editor emitted last. */
function emitted(wrapper: ReturnType<typeof mountEditor>): JsonValue {
  const events = wrapper.emitted('update:modelValue') ?? [];
  return events.at(-1)?.[0] as JsonValue;
}

describe('lookup in the case-variant editor', () => {
  let api: FakeApi;
  beforeEach(() => {
    setActivePinia(createPinia());
    api = installFakeApi(({ url }) =>
      url.pathname === '/x/resolve/variant' ? json(found) : undefined,
    );
  });
  enableAutoUnmount(afterEach);

  it('looks the variant up with the fact’s gene and fills the IDs it picks', async () => {
    const wrapper = mountEditor({
      individuals: [individual],
      geneName: 'MYH7',
      variant: 'c.1208G>A',
      clinVarId: '1',
    });
    await wrapper.get('button.look-up').trigger('click');
    await flushPromises();

    const call = api.calls.find((c) => c.url.pathname === '/x/resolve/variant');
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      q: 'c.1208G>A',
      gene: 'MYH7',
    });
    expect(wrapper.text()).toContain('MANE Select transcript NM_000257.4');
    expect(wrapper.get('.candidate a').attributes('href')).toContain('caid=CA010365');

    await wrapper.get('.candidate button').trigger('click');
    expect(emitted(wrapper)).toEqual({
      individuals: [individual],
      geneName: 'MYH7',
      variant: 'c.1208G>A',
      clinVarId: '14087',
      caid: 'CA010365',
      gnomad: '14-23429278-C-T',
      idSource: 'looked up',
    });
  });

  it('offers nothing to fill for a candidate without a CAID or ClinVar ID', async () => {
    const candidate = { ...found.candidates[0]!, fill: { gnomad: '14-23429278-C-T' } };
    installFakeApi(() => json({ ...found, candidates: [candidate] }));
    const wrapper = mountEditor({ individuals: [individual], variant: 'c.1208G>A' });
    await wrapper.get('button.look-up').trigger('click');
    await flushPromises();
    expect(wrapper.find('.candidate button').exists()).toBe(false);
    expect(wrapper.get('.candidate').text()).toContain('Nothing to fill in');
  });

  it('marks a variant unresolvable and clears its IDs', async () => {
    const wrapper = mountEditor({
      individuals: [individual],
      variant: 'exon 3-5 deletion',
      caid: 'CA1',
      clinVarId: '2',
    });
    await wrapper.get('button.mark-unresolvable').trigger('click');
    expect(emitted(wrapper)).toEqual({
      individuals: [individual],
      variant: 'exon 3-5 deletion',
      idSource: 'unresolvable',
    });
    expect(api.calls).toHaveLength(0);
  });

  it.each([
    ['variant', 'c.1209G>T'],
    ['geneName', 'MYBPC3'],
    ['geneName', ''],
  ])('drops looked-up IDs when %s is edited to "%s"', async (field, next) => {
    const value = { individuals: [individual], geneName: 'MYH7', variant: 'c.1208G>A' };
    const wrapper = mountEditor({
      ...value,
      caid: 'CA010365',
      clinVarId: '14087',
      gnomad: '14-23429278-C-T',
      idSource: 'looked up',
    });
    await wrapper.get(`#field-${field}`).setValue(next);
    const expected: Record<string, JsonValue> = { ...value, [field]: next };
    if (!next) delete expected[field];
    expect(emitted(wrapper)).toEqual(expected);
  });

  it('clears an unresolvable marker when the gene changes', async () => {
    const wrapper = mountEditor({
      individuals: [individual],
      geneName: 'MYH7',
      variant: 'c.1208G>A',
      idSource: 'unresolvable',
    });
    await wrapper.get('#field-geneName').setValue('MYBPC3');
    expect(emitted(wrapper)).toEqual({
      individuals: [individual],
      geneName: 'MYBPC3',
      variant: 'c.1208G>A',
    });
  });

  it('keeps IDs stated in the article when the gene changes', async () => {
    const value = {
      individuals: [individual],
      geneName: 'MYH7',
      variant: 'c.1208G>A',
      caid: 'CA010365',
      idSource: 'stated',
    };
    const wrapper = mountEditor(value);
    await wrapper.get('#field-geneName').setValue('MYBPC3');
    expect(emitted(wrapper)).toEqual({ ...value, geneName: 'MYBPC3' });
  });

  it('is no longer unresolvable once an ID is typed in', async () => {
    const wrapper = mountEditor({
      individuals: [individual],
      variant: 'exon 3-5 deletion',
      idSource: 'unresolvable',
    });
    await wrapper.get('#field-caid').setValue('CA1');
    expect(emitted(wrapper)).toEqual({
      individuals: [individual],
      variant: 'exon 3-5 deletion',
      caid: 'CA1',
    });
  });

  it('says so when lookup is turned off', async () => {
    installFakeApi(() => problem(404, 'Not Found', 'variant lookup is turned off on this server'));
    const wrapper = mountEditor({ individuals: [individual], variant: 'c.1A>G' });
    await wrapper.get('button.look-up').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Type the IDs by hand');
  });

  it('cannot look up an empty variant', () => {
    const wrapper = mountEditor({ individuals: [individual] });
    expect(wrapper.get('button.look-up').attributes('disabled')).toBeDefined();
  });

  it.each(['variant', 'geneName'] as const)(
    'discards an outstanding lookup when %s changes, even if it changes back',
    async (field) => {
      let complete!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => (complete = resolve));
      installFakeApi(() => pending);
      const value = { individuals: [individual], variant: 'c.1208G>A', geneName: 'MYH7' };
      const wrapper = mountEditor(value);
      await wrapper.get('button.look-up').trigger('click');
      await flushPromises();

      await wrapper.setProps({ modelValue: { ...value, [field]: 'changed' } });
      await wrapper.setProps({ modelValue: value });
      complete(json(found));
      await flushPromises();

      expect(wrapper.find('.candidate').exists()).toBe(false);
      expect(wrapper.get('button.look-up').attributes('disabled')).toBeUndefined();
      // A new lookup for the edited value may still succeed.
      installFakeApi(() => json(found));
      await wrapper.get('button.look-up').trigger('click');
      await flushPromises();
      expect(wrapper.find('.candidate').exists()).toBe(true);
    },
  );

  it('discards an outstanding lookup error when the variant changes', async () => {
    let complete!: (response: Response) => void;
    installFakeApi(() => new Promise<Response>((resolve) => (complete = resolve)));
    const wrapper = mountEditor({ individuals: [individual], variant: 'c.1208G>A' });
    await wrapper.get('button.look-up').trigger('click');
    await flushPromises();
    await wrapper.setProps({ modelValue: { individuals: [individual], variant: 'c.1209G>T' } });
    complete(problem(502, 'Bad Gateway', 'old lookup failed'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
