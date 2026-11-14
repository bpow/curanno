import {
  builtinProfiles,
  caseIndividualProfile,
  evidenceExcerptProfile,
  type BodyProfile,
} from '@curanno/model';
import { describe, expect, it } from 'vitest';
import { UnsupportedProfileError, outputSchema } from './schema.js';

function keywords(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => keywords(n, found));
  else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      found.add(key);
      if (key !== 'enum') keywords(value, found);
    }
  }
  return found;
}

describe('outputSchema', () => {
  it.each(builtinProfiles.map((p) => [p.title, p] as const))(
    'projects %s to keywords constrained decoders accept',
    (_title, profile) => {
      const { schema, valueSchema } = outputSchema(profile);
      expect(schema['required']).toEqual(['suggestions']);
      const used = keywords(valueSchema);
      for (const dropped of [
        '$schema',
        '$id',
        'pattern',
        'minLength',
        'maxLength',
        'ontology',
        'uniqueItems',
      ]) {
        expect(used.has(dropped)).toBe(false);
      }
    },
  );

  it('turns ontology fields into label lists and records where they are', () => {
    const { valueSchema, ontologyFields } = outputSchema(caseIndividualProfile);
    const properties = valueSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['casePresentingHpos']).toMatchObject({
      type: 'array',
      items: { type: 'string' },
      title: 'CasePresentingHPOs',
    });
    expect(ontologyFields).toEqual([
      { path: ['casePresentingHpos'], ontology: { name: 'hp', root: 'HP:0000118' } },
      { path: ['caseNotHpos'], ontology: { name: 'hp', root: 'HP:0000118' } },
    ]);
  });

  it('keeps enums, required fields and descriptions', () => {
    const { valueSchema } = outputSchema(evidenceExcerptProfile);
    expect(valueSchema['required']).toEqual(['kind']);
    expect(valueSchema['additionalProperties']).toBe(false);
    const kind = (valueSchema['properties'] as Record<string, Record<string, unknown>>)['kind'];
    expect(kind?.['enum']).toContain('functional');
    expect(kind?.['description']).toMatch(/kind of evidence/);
  });

  it('finds ontology fields inside array items', () => {
    const profile: BodyProfile = {
      iri: 'urn:test:nested',
      title: 'Nested',
      schema: {
        type: 'object',
        properties: {
          people: {
            type: 'array',
            items: {
              type: 'object',
              properties: { terms: { type: 'array', ontology: { name: 'hp' }, items: {} } },
            },
          },
        },
      },
    };
    expect(outputSchema(profile).ontologyFields).toEqual([
      { path: ['people', '*', 'terms'], ontology: { name: 'hp' } },
    ]);
  });

  it('refuses composition it cannot project', () => {
    const profile: BodyProfile = {
      iri: 'urn:test:oneof',
      title: 'One of',
      schema: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    };
    expect(() => outputSchema(profile)).toThrow(UnsupportedProfileError);
  });
});
