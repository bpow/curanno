import { describe, expect, it } from 'vitest';
import { caseVariantProfile } from './builtin.js';
import {
  givesIds,
  lookupContext,
  lookupFieldsOf,
  needsLookup,
  withLookedUp,
  withUnresolvable,
} from './keywords.js';

const [{ field, lookup }] = lookupFieldsOf(caseVariantProfile.schema) as [
  ReturnType<typeof lookupFieldsOf>[number],
];

describe('the lookup keyword on case-variant/1', () => {
  it('names the variant field and its resolver', () => {
    expect(field).toBe('variant');
    expect(lookup.resolver).toBe('variant');
  });

  it('gives the resolver its context from sibling fields', () => {
    expect(lookupContext({ variant: 'c.1A>G', geneName: ' MYH7 ' }, lookup)).toEqual({
      gene: 'MYH7',
    });
    expect(lookupContext({ variant: 'c.1A>G', geneName: ' ' }, lookup)).toEqual({});
  });

  it('fills every field and drops values another candidate left', () => {
    const before = { variant: 'c.1A>G', clinVarId: '9', gnomad: 'old' };
    expect(withLookedUp(before, lookup, { caid: 'CA1' })).toEqual({
      variant: 'c.1A>G',
      caid: 'CA1',
      idSource: 'looked up',
    });
  });

  it('needs lookup until there is a CAID or ClinVar ID, and not when unresolvable', () => {
    expect(needsLookup({ variant: 'c.1A>G' }, field, lookup)).toBe(true);
    expect(needsLookup({ variant: 'c.1A>G', gnomad: '1-2-A-G' }, field, lookup)).toBe(true);
    expect(needsLookup({ variant: 'c.1A>G', clinVarId: '1' }, field, lookup)).toBe(false);
    expect(needsLookup({ variant: ' ' }, field, lookup)).toBe(false);
    const marked = withUnresolvable({ variant: 'exon 3 del', caid: 'CA1', gnomad: 'g' }, lookup);
    expect(marked).toEqual({ variant: 'exon 3 del', gnomad: 'g', idSource: 'unresolvable' });
    expect(needsLookup(marked, field, lookup)).toBe(false);
  });

  it('tells a candidate with IDs from one with only a gnomAD ID', () => {
    expect(givesIds(lookup, { clinVarId: '1' })).toBe(true);
    expect(givesIds(lookup, { gnomad: '1-2-A-G' })).toBe(false);
  });
});
