import { describe, expect, it } from 'vitest';
import { createFakeGuest, documentFromLocation } from './fake';

describe('fake guest', () => {
  it('reads the document from the uri query parameter', () => {
    expect(documentFromLocation('?uri=https%3A%2F%2Fexample.org%2Fpage').uri).toBe(
      'https://example.org/page',
    );
  });

  it('turns a typed selection into a TextQuoteSelector target on the document', () => {
    const guest = createFakeGuest({ document: documentFromLocation('?uri=https://example.org/p') });
    guest.select('some words');
    expect(guest.selection.value?.target).toEqual({
      type: 'SpecificResource',
      source: 'https://example.org/p',
      selector: { type: 'TextQuoteSelector', exact: 'some words' },
    });
    guest.clearSelection();
    expect(guest.selection.value).toBeUndefined();
  });

  it('anchors what it is asked to and honours overrides', () => {
    const guest = createFakeGuest();
    guest.setAnchoringResult('a2', 'orphaned');
    guest.anchor([
      { id: 'a1', target: 'https://example.org/p' },
      { id: 'a2', target: 'https://example.org/p' },
    ]);
    expect(guest.anchoring.value.get('a1')).toBe('anchored');
    expect(guest.anchoring.value.get('a2')).toBe('orphaned');
    guest.unanchor(['a1']);
    expect(guest.anchoring.value.has('a1')).toBe(false);
  });

  it('delivers activations to subscribers until they unsubscribe', () => {
    const guest = createFakeGuest();
    const seen: string[][] = [];
    const off = guest.onActivate((ids) => seen.push(ids));
    guest.activate(['a1']);
    off();
    guest.activate(['a2']);
    expect(seen).toEqual([['a1']]);
  });
});
