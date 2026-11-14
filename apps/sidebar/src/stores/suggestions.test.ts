import { answer, createFakeEndpoint } from '@curanno/extract/testing';
import { caseIndividualProfile, evidenceExcerptProfile } from '@curanno/model';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGuest } from '../guest/fake';
import { installFakeApi, json } from '../test/fake-api';
import { useProfilesStore } from './profiles';
import { useSuggestionsStore } from './suggestions';

const PAGE = 'https://example.org/article';
const TEXT = 'Patient 1 had seizures and ataxia.Patient 2 was unaffected.';
const endpoint = { label: 'Local', url: 'http://127.0.0.1:1234', models: ['m'] };
const document = { uri: PAGE, title: 'Article', links: [{ uri: PAGE, relation: 'self' as const }] };

beforeEach(async () => {
  setActivePinia(createPinia());
  installFakeApi(({ url }) => {
    if (url.pathname === '/x/profiles') {
      return json(
        [evidenceExcerptProfile, caseIndividualProfile].map((p) => ({
          ...p,
          builtin: true,
          enabled: true,
        })),
      );
    }
    if (url.pathname === '/x/ontologies/hp/terms') {
      const q = url.searchParams.get('q');
      return json(
        q === 'Seizures' ? [{ id: 'HP:0001250', label: 'Seizure', synonym: 'Seizures' }] : [],
      );
    }
    return undefined;
  });
  await useProfilesStore().load();
});

afterEach(() => vi.unstubAllGlobals());

function model(suggestions: { quote: string; value: unknown }[]) {
  const fake = createFakeEndpoint(() => answer(suggestions));
  vi.stubGlobal('fetch', fake.fetch);
  return fake;
}

describe('suggestions store', () => {
  it('asks the model about the page and highlights what comes back as suggestions', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT, blockStarts: [34] }] });
    const fake = model([
      {
        quote: 'Patient 1 had seizures and ataxia.',
        value: {
          case: 'Patient 1',
          variants: [{ variant: 'c.1A>G' }],
          casePresentingHpos: ['Seizures', 'ataxia'],
        },
      },
      {
        quote: 'Patient 3 was never mentioned.',
        value: { case: 'Patient 3', variants: [{ variant: 'x' }] },
      },
    ]);
    const store = useSuggestionsStore();
    await store.run(guest, { document, profile: caseIndividualProfile, endpoint, model: 'm' });

    expect(store.status).toBe('done');
    expect(store.rejected).toBe(1);
    expect(fake.requests[0]?.model).toBe('m');
    expect(store.items).toHaveLength(1);
    const [item] = store.items;
    expect(item).toMatchObject({
      documentUri: PAGE,
      profile: caseIndividualProfile.iri,
      value: {
        casePresentingHpos: [{ id: 'HP:0001250', label: 'Seizure' }, { label: 'ataxia' }],
      },
      unresolvedTerms: ['ataxia'],
      target: {
        type: 'SpecificResource',
        source: PAGE,
        selector: [
          { type: 'TextQuoteSelector', exact: 'Patient 1 had seizures and ataxia.' },
          { type: 'TextPositionSelector', start: 0, end: 34 },
        ],
      },
    });
    expect(guest.anchoring.value.get(item!.id)).toBe('anchored');
  });

  it('puts a PDF page suggestion inside its page fragment', async () => {
    const guest = createFakeGuest({
      document,
      text: [
        { text: 'Front page.', page: 1 },
        { text: TEXT, page: 2 },
      ],
    });
    model([{ quote: 'Patient 2 was unaffected.', value: { kind: 'case' } }]);
    const store = useSuggestionsStore();
    await store.run(guest, { document, profile: evidenceExcerptProfile, endpoint, model: 'm' });
    expect(store.items[0]?.target.selector).toEqual([
      {
        type: 'FragmentSelector',
        conformsTo: 'http://tools.ietf.org/rfc/rfc3778',
        value: 'page=2',
        refinedBy: [
          expect.objectContaining({
            type: 'TextQuoteSelector',
            exact: 'Patient 2 was unaffected.',
          }),
          { type: 'TextPositionSelector', start: 34, end: 59 },
        ],
      },
    ]);
  });

  it('withdraws suggestions when discarded or cleared', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    model([
      { quote: 'Patient 1 had seizures', value: { kind: 'case' } },
      { quote: 'Patient 2 was unaffected.', value: { kind: 'case' } },
    ]);
    const store = useSuggestionsStore();
    await store.run(guest, { document, profile: evidenceExcerptProfile, endpoint, model: 'm' });
    const [first, second] = store.items;
    store.discard(guest, first!.id);
    expect(store.items.map((i) => i.id)).toEqual([second!.id]);
    expect(guest.anchoring.value.has(first!.id)).toBe(false);
    store.clear(guest);
    expect(store.items).toEqual([]);
    expect(store.status).toBe('idle');
    expect(guest.anchoring.value.size).toBe(0);
  });

  it('says what went wrong', async () => {
    const store = useSuggestionsStore();
    const silent = createFakeGuest({ document });
    await store.run(silent, { document, profile: evidenceExcerptProfile, endpoint, model: 'm' });
    expect(store.status).toBe('failed');
    expect(store.error).toMatch(/cannot send its text/);

    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await store.run(guest, { document, profile: evidenceExcerptProfile, endpoint, model: 'm' });
    expect(store.status).toBe('failed');
    expect(store.error).toMatch(/could not reach http:\/\/127\.0\.0\.1:1234/);
  });

  it('stops when cancelled', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    let release: () => void = () => undefined;
    const fake = createFakeEndpoint(
      () => new Promise<string>((resolve) => (release = () => resolve(answer([])))),
    );
    vi.stubGlobal('fetch', fake.fetch);
    const store = useSuggestionsStore();
    const running = store.run(guest, {
      document,
      profile: evidenceExcerptProfile,
      endpoint,
      model: 'm',
    });
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    store.cancel();
    release();
    await running;
    expect(store.status).toBe('cancelled');
    expect(store.items).toEqual([]);
  });

  it('stops while the page is still reading out its text', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    guest.requestText = () => new Promise(() => undefined);
    const fake = model([]);
    const store = useSuggestionsStore();
    const running = store.run(guest, {
      document,
      profile: evidenceExcerptProfile,
      endpoint,
      model: 'm',
    });
    expect(store.status).toBe('reading');
    store.cancel();
    await running;
    expect(store.status).toBe('cancelled');
    expect(fake.requests).toHaveLength(0);
  });
});
