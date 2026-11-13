import { describe, expect, it, vi } from 'vitest';
import { exactTerm, resolveOntologyFields, type ResolveTerms } from './terms.js';

const hp = { name: 'hp', root: 'HP:0000118' };
const fields = [
  { path: ['present'], ontology: hp },
  { path: ['people', '*', 'absent'], ontology: hp },
];

describe('resolveOntologyFields', () => {
  it('stores matched terms with their ID and keeps the rest as labels', async () => {
    const resolve = vi.fn<ResolveTerms>((_ontology, labels) => {
      const known: Record<string, { id: string; label: string }> = {
        seizures: { id: 'HP:0001250', label: 'Seizure' },
        Seizure: { id: 'HP:0001250', label: 'Seizure' },
        ataxia: { id: 'HP:0001251', label: 'Ataxia' },
      };
      return Promise.resolve(
        new Map(labels.flatMap((l) => (known[l] ? [[l, known[l]] as const] : []))),
      );
    });
    const result = await resolveOntologyFields(
      {
        present: ['seizures', 'Seizure', 'odd gait', ''],
        people: [{ absent: ['ataxia'] }, { absent: [] }],
        other: 'kept',
      },
      fields,
      resolve,
    );
    expect(result.value).toEqual({
      present: [{ id: 'HP:0001250', label: 'Seizure' }, { label: 'odd gait' }],
      people: [{ absent: [{ id: 'HP:0001251', label: 'Ataxia' }] }, { absent: [] }],
      other: 'kept',
    });
    expect(result.unresolved).toEqual(['odd gait']);
    // One lookup per ontology, every label at once.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[1]).toEqual(['seizures', 'Seizure', 'odd gait', 'ataxia']);
  });

  it('keeps every label when there is no lookup, and drops duplicates', async () => {
    const result = await resolveOntologyFields(
      { present: ['Short stature', 'short stature'] },
      fields,
    );
    expect(result.value).toEqual({ present: [{ label: 'Short stature' }] });
    expect(result.unresolved).toEqual(['Short stature']);
  });

  it('accepts items a model gave as objects, and does not change its input', async () => {
    const input = { present: [{ id: 'HP:9999999', label: 'Made up' }] };
    const result = await resolveOntologyFields(input, fields);
    expect(result.value).toEqual({ present: [{ label: 'Made up' }] });
    expect(input.present[0]).toHaveProperty('id');
  });
});

describe('exactTerm', () => {
  const matches = [
    { id: 'HP:0001250', label: 'Seizure', synonym: 'Seizures' },
    { id: 'HP:0002069', label: 'Bilateral tonic-clonic seizure' },
  ];

  it('matches a label or the synonym that matched, ignoring case', () => {
    expect(exactTerm('seizures', matches)).toEqual({ id: 'HP:0001250', label: 'Seizure' });
    expect(exactTerm(' Bilateral tonic-clonic seizure ', matches)?.id).toBe('HP:0002069');
  });

  it('takes nothing that merely contains the label', () => {
    expect(exactTerm('tonic-clonic', matches)).toBeUndefined();
  });
});
