import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Term } from '../profiles/schema';
import { installFakeApi, json, problem, type FakeApi } from '../test/fake-api';
import TermListInput from './TermListInput.vue';

const hcm = { id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy', synonym: 'HCM' };
const cm = { id: 'HP:0001638', label: 'Cardiomyopathy' };

// In the document, as Enter only takes a highlighted suggestion that is.
function mountInput(modelValue: Term[] = []) {
  return mount(TermListInput, {
    attachTo: document.body,
    props: {
      modelValue,
      ontology: { name: 'hp', root: 'HP:0000118' },
      inputId: 'field-phenotypes',
      name: 'phenotypes',
    },
  });
}

/** Types, waits out the debounce and the lookup, and lets the list settle on its highlight. */
async function type(wrapper: ReturnType<typeof mountInput>, text: string): Promise<void> {
  await wrapper.find('input').setValue(text);
  await vi.advanceTimersByTimeAsync(250);
  await flushPromises();
  await flushPromises();
}

describe('TermListInput', () => {
  let api: FakeApi;
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    api = installFakeApi(({ url }) =>
      url.pathname === '/x/ontologies/hp/terms' ? json([cm, hcm]) : undefined,
    );
  });
  afterEach(() => vi.useRealTimers());
  enableAutoUnmount(afterEach);

  it('searches the ontology branch once the query is long enough', async () => {
    const wrapper = mountInput();
    const searches = () => api.calls.filter((c) => c.url.pathname.endsWith('/terms'));
    await type(wrapper, 'c');
    expect(searches()).toHaveLength(0);
    await type(wrapper, 'cardio');
    expect(searches()).toHaveLength(1);
    expect(Object.fromEntries(searches()[0]?.url.searchParams ?? [])).toEqual({
      q: 'cardio',
      root: 'HP:0000118',
      limit: '10',
    });
    const options = wrapper.findAll('[role="option"]');
    expect(options.map((o) => o.text())).toEqual([
      'Cardiomyopathy HP:0001638',
      expect.stringContaining('Hypertrophic cardiomyopathy HP:0001639'),
    ]);
    expect(options[1]?.find('.synonym').text()).toBe('matched “HCM”');
    expect(wrapper.find('input').attributes('aria-expanded')).toBe('true');
  });

  it('highlights the first suggestion, moves with the arrows and stores the one Enter takes', async () => {
    const wrapper = mountInput();
    await type(wrapper, 'hcm');
    const input = wrapper.find('input');
    const ids = wrapper.findAll('[role="option"]').map((o) => o.attributes('id'));
    expect(input.attributes('aria-controls')).toBe(wrapper.find('.suggestions').attributes('id'));
    expect(input.attributes('aria-activedescendant')).toBe(ids[0]);
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe(ids[1]);
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toEqual([
      [[{ id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy' }]],
    ]);
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    expect(input.element.value).toBe('');
  });

  it('takes the first suggestion on Enter alone, and does not repeat a term', async () => {
    const wrapper = mountInput([{ id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy' }]);
    await type(wrapper, 'cardio');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const both = [
      { id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy' },
      { id: 'HP:0001638', label: 'Cardiomyopathy' },
    ];
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([both]);

    await wrapper.setProps({ modelValue: both });
    await type(wrapper, 'cardio');
    await wrapper.findAll('[role="option"]')[0]?.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([both]);
    expect(wrapper.findAll('.term')).toHaveLength(2);
  });

  it('keeps text that matches no term, once whatever its case', async () => {
    installFakeApi(() => json([]));
    const wrapper = mountInput([{ id: 'HP:0001638', label: 'Cardiomyopathy' }]);
    const withText = [
      { id: 'HP:0001638', label: 'Cardiomyopathy' },
      { label: 'exertional chest pain' },
    ];
    await type(wrapper, ' exertional chest pain ');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([withText]);

    await wrapper.setProps({ modelValue: withText });
    await type(wrapper, 'Exertional Chest Pain');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([withText]);
  });

  it('marks free text and removes terms', async () => {
    const wrapper = mountInput([{ id: 'HP:0001638', label: 'Cardiomyopathy' }, { label: 'odd' }]);
    expect(wrapper.findAll('.term.text').map((t) => t.text())).toEqual(['odd×']);
    await wrapper.findAll('.term')[0]?.find('button').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[{ label: 'odd' }]]);
  });

  it('says so when the ontology is not loaded, and still accepts text', async () => {
    installFakeApi(() => problem(404, 'Not Found', 'no ontology hp is loaded'));
    const wrapper = mountInput();
    await type(wrapper, 'cardio');
    expect(wrapper.text()).toContain('Term lookup is unavailable');
    await wrapper.find('input').trigger('blur');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[{ label: 'cardio' }]]);
  });

  it("names the ontology and its release, as HPO's license asks", async () => {
    installFakeApi(({ url }) =>
      url.pathname === '/x/ontologies'
        ? json([
            {
              name: 'hp',
              title: 'Human Phenotype Ontology',
              version: '2026-09-01',
              homepage: 'http://www.human-phenotype-ontology.org',
              terms: 19894,
              loaded: '2026-11-10T00:00:00Z',
            },
          ])
        : undefined,
    );
    const wrapper = mountInput();
    await flushPromises();
    expect(wrapper.find('.attribution').text().replace(/\s+/g, ' ')).toBe(
      'This service uses the Human Phenotype Ontology (version 2026-09-01). ' +
        'Find out more at http://www.human-phenotype-ontology.org',
    );
    expect(wrapper.find('.attribution a').attributes('href')).toBe(
      'http://www.human-phenotype-ontology.org',
    );
  });
});
