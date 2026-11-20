import { builtinProfiles } from '@curanno/model';
import { describe, expect, it } from 'vitest';
import type { Draft, DraftItem } from './draft.ts';
import {
  LookupUnavailable,
  resolveDraft,
  type Candidate,
  type Resolution,
  type Resolve,
} from './resolve.ts';

const myh7: Candidate = {
  label: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
  fill: { caid: 'CA010365', clinVarId: '14087', gnomad: '14-23429278-C-T' },
  facts: [],
  autoFill: true,
  warnings: [],
};
const doubtful: Candidate = { ...myh7 };
delete doubtful.autoFill;

const answer = (
  query: string,
  candidates: Candidate[],
  warnings: Resolution['warnings'] = [],
): Resolution => ({ query, context: {}, candidates, warnings, steps: [] });

const variant = (id: string, value: Record<string, string>): DraftItem => ({
  id,
  kind: 'case-variant',
  quote: 'quote',
  value: { individuals: ['_:i1'], ...value },
});

const draft = (items: DraftItem[], notInBatch?: string[]): Draft => ({
  article: 'PMC0000001',
  gene: 'MYH7',
  engine: { model: 'model', skill: 'curanno-suggest', version: '1' },
  items,
  ...(notInBatch ? { notInBatch } : {}),
});

function resolver(answers: Record<string, Resolution | Error>) {
  const asked: [string, string, Record<string, string>][] = [];
  const resolve: Resolve = (name, q, context) => {
    asked.push([name, q, context]);
    const a = answers[q];
    if (!a) throw new Error(`unexpected query ${q}`);
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  return { resolve, asked };
}

describe('resolveDraft', () => {
  it('fills the IDs of the candidate the resolver marks for filling', async () => {
    const { resolve, asked } = resolver({
      'c.1208G>A (p.Arg403Gln)': answer(
        'c.1208G>A (p.Arg403Gln)',
        [myh7],
        [{ code: 'transcript-assumed', message: 'MANE Select NM_000257.4 was used.' }],
      ),
    });
    const { draft: next, outcomes } = await resolveDraft(
      draft([variant('_:v1', { variant: 'c.1208G>A (p.Arg403Gln)' })]),
      { profiles: builtinProfiles, resolve },
    );
    expect(asked).toEqual([['variant', 'c.1208G>A (p.Arg403Gln)', { gene: 'MYH7' }]]);
    expect(next.items[0]!.value).toEqual({
      individuals: ['_:i1'],
      variant: 'c.1208G>A (p.Arg403Gln)',
      caid: 'CA010365',
      clinVarId: '14087',
      gnomad: '14-23429278-C-T',
      idSource: 'looked up',
    });
    expect(outcomes).toEqual([
      {
        item: '_:v1',
        field: 'variant',
        text: 'c.1208G>A (p.Arg403Gln)',
        outcome: 'filled',
        filled: { caid: 'CA010365', clinVarId: '14087', gnomad: '14-23429278-C-T' },
        notes: ['MANE Select NM_000257.4 was used.'],
      },
    ]);
    expect(next.notInBatch).toBeUndefined();
  });

  it('keeps a gnomAD ID the article states', async () => {
    const { resolve } = resolver({ 'c.1208G>A': answer('c.1208G>A', [myh7]) });
    const { draft: next, outcomes } = await resolveDraft(
      draft([variant('_:v1', { variant: 'c.1208G>A', gnomad: 'absent from gnomAD' })]),
      { profiles: builtinProfiles, resolve },
    );
    expect(next.items[0]!.value).toMatchObject({ caid: 'CA010365', gnomad: 'absent from gnomAD' });
    expect(outcomes[0]!.filled).toEqual({ caid: 'CA010365', clinVarId: '14087' });
  });

  it('prefers the fact’s own gene', async () => {
    const { resolve, asked } = resolver({ 'c.1A>G': answer('c.1A>G', [myh7]) });
    await resolveDraft(draft([variant('_:v1', { variant: 'c.1A>G', geneName: 'TNNT2' })]), {
      profiles: builtinProfiles,
      resolve,
    });
    expect(asked).toEqual([['variant', 'c.1A>G', { gene: 'TNNT2' }]]);
  });

  it('leaves stated IDs, unresolvable variants and other kinds alone', async () => {
    const { resolve, asked } = resolver({});
    const items: DraftItem[] = [
      variant('_:v1', { variant: 'c.1A>G', clinVarId: '1', idSource: 'stated' }),
      variant('_:v2', { variant: 'exon 3 deletion', idSource: 'unresolvable' }),
      { id: '_:i1', kind: 'individual', quote: 'q', value: { case: 'II-1' } },
    ];
    const { draft: next, outcomes } = await resolveDraft(draft(items), {
      profiles: builtinProfiles,
      resolve,
    });
    expect(asked).toEqual([]);
    expect(outcomes).toEqual([]);
    expect(next.items).toEqual(items);
  });

  it('leaves a choice to the curator, with the candidates under notInBatch', async () => {
    const other: Candidate = {
      ...doubtful,
      label: 'NM_000257.4(MYH7):c.1207C>A',
      fill: { caid: 'CA2' },
    };
    const { resolve } = resolver({
      'p.R403Q': answer(
        'p.R403Q',
        [doubtful, other],
        [
          { code: 'protein-only', message: 'Only a protein change was given.' },
          { code: 'several-candidates', message: '2 registered cDNA changes produce it.' },
        ],
      ),
      'NM_000257.4:c.1208C>A': answer(
        'NM_000257.4:c.1208C>A',
        [],
        [{ code: 'reference-mismatch', message: 'given=C, found=G.' }],
      ),
    });
    const { draft: next, outcomes } = await resolveDraft(
      draft(
        [
          variant('_:v1', { variant: 'p.R403Q' }),
          variant('_:v2', { variant: 'NM_000257.4:c.1208C>A' }),
        ],
        ['Patient 7 is only in the supplement.', 'Lookup _:v9: an earlier run.'],
      ),
      { profiles: builtinProfiles, resolve },
    );
    expect(outcomes.map((o) => o.outcome)).toEqual(['left', 'left']);
    expect(next.items.map((i) => i.value)).toEqual([
      { individuals: ['_:i1'], variant: 'p.R403Q' },
      { individuals: ['_:i1'], variant: 'NM_000257.4:c.1208C>A' },
    ]);
    expect(next.notInBatch).toEqual([
      'Patient 7 is only in the supplement.',
      'Lookup _:v1: p.R403Q needs a curator to choose: NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln) (caid CA010365, clinVarId 14087); NM_000257.4(MYH7):c.1207C>A (caid CA2). Only a protein change was given. 2 registered cDNA changes produce it.',
      'Lookup _:v2: NM_000257.4:c.1208C>A found nothing. given=C, found=G.',
    ]);
  });

  it('does not fill a single candidate the resolver does not mark', async () => {
    const warned = {
      ...doubtful,
      warnings: [{ code: 'protein-differs', message: 'p.Arg403Trp.' }],
    };
    const { resolve } = resolver({ 'c.1208G>A (p.Arg403Trp)': answer('q', [warned]) });
    const { outcomes } = await resolveDraft(
      draft([variant('_:v1', { variant: 'c.1208G>A (p.Arg403Trp)' })]),
      { profiles: builtinProfiles, resolve },
    );
    expect(outcomes[0]).toMatchObject({ outcome: 'left', notes: ['p.Arg403Trp.'] });
  });

  it('reports a lookup that failed and carries on', async () => {
    const { resolve } = resolver({
      'c.1A>G': new Error('Bad Gateway'),
      'c.1208G>A': answer('c.1208G>A', [myh7]),
    });
    const { outcomes, draft: next } = await resolveDraft(
      draft([variant('_:v1', { variant: 'c.1A>G' }), variant('_:v2', { variant: 'c.1208G>A' })]),
      { profiles: builtinProfiles, resolve },
    );
    expect(outcomes.map((o) => o.outcome)).toEqual(['failed', 'filled']);
    expect(next.notInBatch).toEqual(['Lookup _:v1: c.1A>G could not be looked up. Bad Gateway']);
  });

  it('removes obsolete failure notes when a rerun resolves every item', async () => {
    const { resolve } = resolver({
      'NM_000257.4:c.1208G>A': answer('NM_000257.4:c.1208G>A', [myh7]),
    });
    const { draft: next, outcomes } = await resolveDraft(
      draft(
        [variant('_:v1', { variant: 'NM_000257.4:c.1208G>A' })],
        ['Lookup _:v1: could not be looked up. Bad Gateway'],
      ),
      { profiles: builtinProfiles, resolve },
    );
    expect(outcomes[0]!.outcome).toBe('filled');
    expect(next.notInBatch).toBeUndefined();
  });

  it('stops when the lookup is turned off', async () => {
    const { resolve } = resolver({ 'c.1A>G': new LookupUnavailable('turned off') });
    await expect(
      resolveDraft(draft([variant('_:v1', { variant: 'c.1A>G' })]), {
        profiles: builtinProfiles,
        resolve,
      }),
    ).rejects.toThrow('turned off');
  });
});
