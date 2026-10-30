import type { Annotation } from '@scale/api-client';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { createFakeGuest } from './guest/fake';
import { useAnnotationsStore } from './stores/annotations';
import { useGuestSync } from './use-guest-sync';

const PAGE = 'https://example.org/page';
const IRI = 'https://annotations.test/annotations/11111111-1111-4111-8111-111111111111';

function annotation(target: Annotation['target'], created = '2026-10-30T08:00:00Z'): Annotation {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: IRI,
    type: 'Annotation',
    created,
    modified: created,
    body: { type: 'TextualBody', value: 'A note' },
    target,
  };
}

const original = {
  type: 'SpecificResource',
  source: PAGE,
  selector: { type: 'TextQuoteSelector', exact: 'original words' },
} as Annotation['target'];

describe('useGuestSync', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('anchors arrivals, re-anchors a changed target and withdraws deletions', async () => {
    const store = useAnnotationsStore();
    const guest = createFakeGuest({ document: { uri: PAGE, links: [] } });
    const scope = effectScope();
    scope.run(() => useGuestSync(guest, store));

    // Another user's annotation arrives over the event stream.
    store.applyEvent('created', IRI, annotation(original));
    await nextTick();
    expect(guest.log.value).toEqual(['anchor 1']);
    expect(guest.anchoring.value.get(IRI)).toBe('anchored');

    // An edit that leaves the target alone does not re-anchor.
    store.applyEvent('updated', IRI, annotation(original, '2026-10-30T09:00:00Z'));
    await nextTick();
    expect(guest.log.value).toEqual(['anchor 1']);

    // A repair by another user changes the target: anchored again with the repair.
    const repaired = {
      ...(original as object),
      anchoring: {
        state: 'repaired',
        repair: {
          selector: { type: 'TextQuoteSelector', exact: 'new words' },
          created: '2026-10-30T10:00:00Z',
        },
      },
    };
    store.applyEvent('updated', IRI, annotation(repaired as Annotation['target']));
    await nextTick();
    expect(guest.log.value).toEqual(['anchor 1', 'anchor 1']);

    // Deleted elsewhere: the highlight goes.
    store.applyEvent('deleted', '11111111-1111-4111-8111-111111111111');
    await nextTick();
    expect(guest.log.value).toEqual(['anchor 1', 'anchor 1', 'unanchor 1']);
    expect(guest.anchoring.value.has(IRI)).toBe(false);
    scope.stop();
  });
});
