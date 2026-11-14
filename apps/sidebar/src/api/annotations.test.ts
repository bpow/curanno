import type { Annotation } from '@curanno/api-client';
import { describe, expect, it } from 'vitest';
import { draftOf, rebuildInput, repairInput, withEditor } from './annotations';

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

describe('drafts of structured bodies', () => {
  it('keep who made the body through an edit (ADR 0034)', () => {
    const creator = [
      { type: 'Software' as const, name: 'curanno-extract', nickname: 'm / prompt 1' },
      { type: 'Person' as const, id: 'https://annotations.test/x/users/u-1' },
    ];
    const annotation = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      id: 'https://annotations.test/annotations/11111111-1111-4111-8111-111111111111',
      type: 'Annotation',
      target: 'https://example.org/page',
      body: {
        type: 'StructuredBody',
        profile: 'https://curanno.example/profiles/evidence-excerpt/1',
        value: { kind: 'case' },
        creator,
        created: '2026-11-13T12:00:00.000Z',
      },
    } as unknown as Annotation;
    const draft = draftOf(annotation);
    expect(draft.structured).toMatchObject({ creator, created: '2026-11-13T12:00:00.000Z' });
    const input = rebuildInput(annotation, {
      ...draft,
      structured: { ...draft.structured!, value: { kind: 'other' } },
    });
    expect(input.body).toMatchObject({ value: { kind: 'other' }, creator });
  });
});

describe('withEditor', () => {
  const model = { type: 'Software' as const, name: 'curanno-extract', nickname: 'm / prompt 1' };
  const me = 'https://annotations.test/x/users/u-1';
  const curator = () => Promise.resolve(me);
  const made = { profile: 'p', value: { kind: 'case' }, creator: model };

  it('adds the curator when they change the value of a body that names its maker', async () => {
    expect(await withEditor(made, { ...made, value: { kind: 'other' } }, curator)).toEqual({
      ...made,
      value: { kind: 'other' },
      creator: [model, { type: 'Person', id: me }],
    });
  });

  it('leaves the body alone otherwise', async () => {
    const unchanged = { ...made, value: { kind: 'case' } };
    expect(await withEditor(made, unchanged, curator)).toBe(unchanged);
    const unnamed = { profile: 'p', value: { kind: 'other' } };
    expect(await withEditor({ profile: 'p', value: {} }, unnamed, curator)).toBe(unnamed);
    const already = {
      ...made,
      value: { kind: 'x' },
      creator: [model, { type: 'Person' as const, id: me }],
    };
    expect(await withEditor(made, already, curator)).toBe(already);
  });
});
