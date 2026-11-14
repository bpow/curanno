import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Term } from '../profiles/schema';
import { createApiClient } from '@curanno/api-client';
import { setApiClient } from '../api/client';
import { installFakeApi, json, problem, type FakeApi } from '../test/fake-api';
import TermListInput from './TermListInput.vue';

const hcm = { id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy', synonym: 'HCM' };
const cm = { id: 'HP:0001638', label: 'Cardiomyopathy' };

function mountInput(modelValue: Term[] = []) {
  return mount(TermListInput, {
    props: {
      modelValue,
      ontology: { name: 'hp', root: 'HP:0000118' },
      inputId: 'field-phenotypes',
      name: 'phenotypes',
    },
  });
}

async function type(wrapper: ReturnType<typeof mountInput>, text: string): Promise<void> {
  await wrapper.find('input').setValue(text);
  await vi.advanceTimersByTimeAsync(250);
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

  it('cancels a search that a newer one replaced', async () => {
    const signals: AbortSignal[] = [];
    setApiClient(
      createApiClient({
        baseUrl: 'http://api.test',
        fetch: (input) => {
          const { signal, url } = input as Request;
          if (!url.includes('/terms')) return Promise.resolve(json([]));
          signals.push(signal);
          // The first search stays open until it is cancelled.
          if (signals.length > 1) return Promise.resolve(json([hcm]));
          return new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
          );
        },
      }),
    );
    const wrapper = mountInput();
    await type(wrapper, 'cardio');
    await type(wrapper, 'hypertrophic');
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
  });

  it('picks a suggestion with the keyboard and stores its ID and label', async () => {
    const wrapper = mountInput();
    await type(wrapper, 'hcm');
    const input = wrapper.find('input');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe('field-phenotypes-suggestions-1');
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      [{ id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy' }],
    ]);
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
  });

  it('keeps text that matches no term, and skips duplicates', async () => {
    const wrapper = mountInput([{ id: 'HP:0001638', label: 'Cardiomyopathy' }]);
    await type(wrapper, 'exertional chest pain');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      [{ id: 'HP:0001638', label: 'Cardiomyopathy' }, { label: 'exertional chest pain' }],
    ]);

    await type(wrapper, 'cardio');
    await wrapper.findAll('[role="option"]')[0]?.trigger('mousedown');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('marks free text and removes terms', async () => {
    const wrapper = mountInput([{ id: 'HP:0001638', label: 'Cardiomyopathy' }, { label: 'odd' }]);
    expect(wrapper.findAll('.term.text').map((t) => t.text())).toEqual(['odd ×']);
    await wrapper.find('button[aria-label="Remove Cardiomyopathy"]').trigger('click');
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
