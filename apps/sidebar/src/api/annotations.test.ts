import type { Annotation } from '@curanno/api-client';
import { describe, expect, it } from 'vitest';
import { repairInput } from './annotations';

const PAGE = 'https://example.org/page';

describe('repairInput', () => {
  it('records the repair and keeps every body and extension property', () => {
    const body = [
      { type: 'TextualBody', value: 'First comment', purpose: 'commenting' },
      { type: 'TextualBody', value: 'Second comment', purpose: 'commenting', language: 'en' },
      { id: 'https://example.org/figure.png', type: 'Image', format: 'image/png' },
      { type: 'TextualBody', value: 'review', purpose: 'tagging' },
    ];
    const annotation = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      id: 'https://annotations.test/annotations/11111111-1111-4111-8111-111111111111',
      type: 'Annotation',
      motivation: 'commenting',
      created: '2026-10-30T08:00:00Z',
      modified: '2026-10-30T08:00:00Z',
      permissions: ['read', 'update'],
      body,
      target: {
        type: 'SpecificResource',
        source: PAGE,
        selector: { type: 'TextQuoteSelector', exact: 'old words' },
        anchoring: { state: 'orphaned' },
      },
      'https://example.org/ns#extra': { kept: true },
    } as unknown as Annotation;

    const input = repairInput(annotation, { type: 'TextQuoteSelector', exact: 'new words' });

    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('created');
    expect(input).not.toHaveProperty('permissions');
    expect((input as Record<string, unknown>)['body']).toEqual(body);
    expect((input as Record<string, unknown>)['https://example.org/ns#extra']).toEqual({
      kept: true,
    });
    expect(input.target).toMatchObject({
      source: PAGE,
      selector: { type: 'TextQuoteSelector', exact: 'old words' },
      anchoring: {
        state: 'repaired',
        repair: { selector: { type: 'TextQuoteSelector', exact: 'new words' } },
      },
    });
  });
});
