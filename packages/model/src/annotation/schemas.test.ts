import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { addAnnotationFormats } from './formats.js';
import { SCHEMA_BASE, annotationSchemas } from './schemas.js';
import { WEB_ANNOTATION_CONTEXT, type Annotation, type AnnotationInput } from './types.js';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats.default(ajv);
addAnnotationFormats(ajv);
for (const schema of Object.values(annotationSchemas)) ajv.addSchema(schema);

const validate = (name: string, data: unknown): string[] => {
  const fn = ajv.getSchema(SCHEMA_BASE + name);
  if (!fn) throw new Error(`no schema ${name}`);
  return fn(data) ? [] : (fn.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`);
};

const annotation: Annotation = {
  '@context': WEB_ANNOTATION_CONTEXT,
  id: 'https://example.org/annotations/1',
  type: 'Annotation',
  created: '2026-10-29T12:00:00Z',
  creator: { id: 'https://example.org/users/alice', type: 'Person', name: 'Alice' },
  motivation: 'commenting',
  body: [
    { type: 'TextualBody', value: 'A comment', format: 'text/plain', purpose: 'commenting' },
    {
      type: 'StructuredBody',
      profile: 'https://scale.example/profiles/evidence-excerpt/1',
      value: { kind: 'case', identifiers: ['PMID:12345'] },
    },
  ],
  target: {
    source: 'https://example.org/page',
    selector: [
      { type: 'TextQuoteSelector', exact: 'world', prefix: 'Hello ' },
      { type: 'TextPositionSelector', start: 6, end: 11 },
    ],
    anchoring: { state: 'anchored' },
  },
  permissions: ['read', 'update'],
  'ex:extension': { kept: true },
};

describe('annotation schemas', () => {
  it('compile under strict Ajv', () => {
    for (const name of Object.keys(annotationSchemas))
      expect(ajv.getSchema(SCHEMA_BASE + name)).toBeTruthy();
  });

  it('accept a full annotation', () => {
    expect(validate('Annotation', annotation)).toEqual([]);
  });

  it('accept an input without server-assigned fields', () => {
    const input: AnnotationInput = {
      type: 'Annotation',
      body: 'https://example.org/bodies/1',
      target: 'https://example.org/page',
    };
    expect(validate('AnnotationInput', input)).toEqual([]);
  });

  it('reject an annotation without a target', () => {
    const rest: Record<string, unknown> = { ...annotation };
    delete rest['target'];
    expect(validate('Annotation', rest)).toContainEqual(expect.stringContaining('target'));
  });

  it('reject a selector of unknown type', () => {
    expect(validate('Selector', { type: 'Bogus', value: 'x' }).length).toBeGreaterThan(0);
  });

  it('reject negative positions', () => {
    expect(
      validate('TextPositionSelector', { type: 'TextPositionSelector', start: -1, end: 2 }),
    ).not.toEqual([]);
  });

  it('accept nested refinedBy and RangeSelector', () => {
    expect(
      validate('Selector', {
        type: 'RangeSelector',
        startSelector: {
          type: 'XPathSelector',
          value: '/html/body/p[1]',
          refinedBy: { type: 'TextPositionSelector', start: 0, end: 1 },
        },
        endSelector: { type: 'CssSelector', value: 'p:nth-of-type(2)' },
      }),
    ).toEqual([]);
  });

  it('accept a repaired target and reject an unknown anchoring state', () => {
    expect(
      validate('AnchoredTarget', {
        source: 'https://example.org/page',
        selector: { type: 'TextQuoteSelector', exact: 'gone' },
        anchoring: {
          state: 'repaired',
          repair: {
            selector: { type: 'TextQuoteSelector', exact: 'here' },
            created: '2026-10-29T12:00:00Z',
          },
        },
      }),
    ).toEqual([]);
    expect(validate('Anchoring', { state: 'lost' })).not.toEqual([]);
  });

  it('require a profile on structured bodies', () => {
    expect(validate('Body', { type: 'StructuredBody', value: {} })).not.toEqual([]);
  });
});
