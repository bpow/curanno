import type { Annotation } from '@curanno/api-client';
import { answer, createFakeEndpoint } from '@curanno/extract/testing';
import { evidenceExcerptProfile } from '@curanno/model';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { GUEST_KEY } from '../guest';
import { createFakeGuest, type FakeGuest } from '../guest/fake';
import { useProfilesStore } from '../stores/profiles';
import { installFakeApi, json, type FakeApi } from '../test/fake-api';
import AnnotationEditor from './AnnotationEditor.vue';
import SuggestPanel from './SuggestPanel.vue';

const PAGE = 'https://example.org/article';
const TEXT = 'Functional studies showed reduced activity. The variant was absent from gnomAD.';
const document = { uri: PAGE, title: 'Article', links: [{ uri: PAGE, relation: 'self' as const }] };

let api: FakeApi;
let guest: FakeGuest;

beforeEach(async () => {
  setActivePinia(createPinia());
  config.extractEndpoints = [
    { label: 'LM Studio', url: 'http://127.0.0.1:1234', models: ['qwen'] },
  ];
  api = installFakeApi(({ method, url, body }) => {
    if (url.pathname === '/x/profiles') {
      return json([{ ...evidenceExcerptProfile, builtin: true, enabled: true }]);
    }
    if (url.pathname === '/x/documents') return json({ id: 'd1' }, { status: 201 });
    if (method === 'PUT' && url.pathname.endsWith('/acl')) {
      return json({ status: 403, title: 'Forbidden' }, { status: 403 });
    }
    if (method === 'POST' && url.pathname === '/annotations/') {
      const created: Annotation = {
        ...(body as Annotation),
        '@context': 'http://www.w3.org/ns/anno.jsonld',
        id: 'https://annotations.test/annotations/11111111-1111-4111-8111-111111111111',
        created: '2026-11-13T12:00:00Z',
      };
      return json(created, { status: 201 });
    }
    return undefined;
  });
  await useProfilesStore().load();
  guest = createFakeGuest({ document, text: [{ text: TEXT }] });
  vi.stubGlobal(
    'fetch',
    createFakeEndpoint(() =>
      answer([
        { quote: 'Functional studies showed reduced activity.', value: { kind: 'functional' } },
        { quote: 'The variant was absent from gnomAD.', value: { kind: 'population' } },
      ]),
    ).fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  config.extractEndpoints = [];
});

function mountPanel() {
  return mount(SuggestPanel, { global: { provide: { [GUEST_KEY as symbol]: guest } } });
}

describe('SuggestPanel', () => {
  it('is not offered without an endpoint or a page that can send its text', () => {
    config.extractEndpoints = [];
    expect(mountPanel().find('section').exists()).toBe(false);
    config.extractEndpoints = [{ label: 'x', url: 'http://127.0.0.1:1234', models: [] }];
    guest.setText(undefined);
    expect(mountPanel().find('section').exists()).toBe(false);
  });

  it('says where the text goes, then lists the suggestions highlighted in the page', async () => {
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    expect(wrapper.text()).toContain('is sent to 127.0.0.1:1234 (LM Studio)');
    expect((wrapper.find('select[name="model"]').element as HTMLSelectElement).value).toBe('qwen');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.findAll('li.suggestion')).toHaveLength(2));
    expect(wrapper.text()).toContain('2 suggestions');
    expect(guest.anchoring.value.size).toBe(2);
  });

  it('saves a reviewed suggestion with the model as the body creator, and drops it from the list', async () => {
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    await wrapper.find('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.findAll('li.suggestion')).toHaveLength(2));

    const card = wrapper.findAll('li.suggestion')[0]!;
    await card.find('button.primary').trigger('click');
    await card.find('form').trigger('submit');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.findAll('li.suggestion')).toHaveLength(1));

    const posted = api.calls.find((c) => c.method === 'POST' && c.url.pathname === '/annotations/');
    expect(posted?.body).toMatchObject({
      motivation: 'classifying',
      target: {
        source: PAGE,
        selector: [
          { type: 'TextQuoteSelector', exact: 'Functional studies showed reduced activity.' },
          { type: 'TextPositionSelector', start: 0, end: 43 },
        ],
      },
      body: {
        type: 'StructuredBody',
        profile: evidenceExcerptProfile.iri,
        value: { kind: 'functional' },
        creator: { type: 'Software', name: 'curanno-extract', nickname: 'qwen / prompt 1' },
      },
    });
  });

  it('discards a suggestion and takes its highlight back', async () => {
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    await wrapper.find('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.findAll('li.suggestion')).toHaveLength(2));
    const discard = wrapper
      .findAll('li.suggestion')[1]!
      .findAll('button')
      .find((b) => b.text() === 'Discard');
    await discard!.trigger('click');
    expect(wrapper.findAll('li.suggestion')).toHaveLength(1);
    expect(guest.anchoring.value.size).toBe(1);
  });
  it('still says so when a saved suggestion could not be shared', async () => {
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    await wrapper.find('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.findAll('li.suggestion')).toHaveLength(2));
    await wrapper.findAll('li.suggestion')[0]!.find('button.primary').trigger('click');
    wrapper.findComponent(AnnotationEditor).vm.$emit('save', {
      text: '',
      tags: [],
      structured: { profile: evidenceExcerptProfile.iri, value: { kind: 'functional' } },
      acl: [{ principal: { kind: 'group', id: 'g1', name: 'Curators' }, permission: 'read' }],
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Saved, but not shared'));
    expect(wrapper.findAll('li.suggestion')).toHaveLength(1);
  });

  it('drops a run whose page went away before the model answered', async () => {
    let release: () => void = () => undefined;
    const fake = createFakeEndpoint(
      () =>
        new Promise<string>(
          (resolve) =>
            (release = () =>
              resolve(
                answer([
                  { quote: 'The variant was absent from gnomAD.', value: { kind: 'population' } },
                ]),
              )),
        ),
    );
    vi.stubGlobal('fetch', fake.fetch);
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    await wrapper.find('form').trigger('submit');
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    guest.setDocument('https://example.org/elsewhere');
    await flushPromises();
    release();
    await flushPromises();
    expect(wrapper.findAll('li.suggestion')).toHaveLength(0);
    expect(guest.anchoring.value.size).toBe(0);
  });
});
