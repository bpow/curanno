import { describe, expect, it } from 'vitest';
import { toResolution } from './resolution.js';
import type { VariantCandidate, VariantResolution } from './resolver.js';

const myh7: VariantCandidate = {
  caid: 'CA010365',
  title: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
  registryUrl: 'https://reg.example/CA010365',
  geneSymbol: 'MYH7',
  hgvs: {
    genomic: 'NC_000014.9:g.23429278C>T',
    transcript: 'NM_000257.4:c.1208G>A',
    protein: 'NP_000248.2:p.Arg403Gln',
  },
  clinVar: [{ variationId: '14087', url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/14087/' }],
  gnomad: '14-23429278-C-T',
  warnings: [],
};

const assumed = [{ code: 'transcript-assumed' as const, message: 'MANE Select was used.' }];

const result = (
  candidates: VariantCandidate[],
  warnings: VariantResolution['warnings'] = [],
): VariantResolution => ({ query: 'q', gene: 'MYH7', candidates, warnings, steps: [] });

const autoFill = (r: VariantResolution) => toResolution(r).candidates.map((c) => !!c.autoFill);

describe('toResolution', () => {
  it('gives the IDs to fill, the facts to show and the services by name', () => {
    const r = toResolution({
      ...result([myh7]),
      steps: [{ service: 'registry', request: 'NM_000257.4:c.1208G>A', outcome: 'found' }],
    });
    expect(r.context).toEqual({ gene: 'MYH7' });
    expect(r.steps[0]!.service).toBe('Allele Registry');
    expect(r.candidates[0]).toEqual({
      label: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
      fill: { caid: 'CA010365', clinVarId: '14087', gnomad: '14-23429278-C-T' },
      facts: [
        { label: 'CAID', values: [{ text: 'CA010365', url: 'https://reg.example/CA010365' }] },
        { label: 'ClinVar', values: [{ text: '14087', url: myh7.clinVar[0]!.url }] },
        { label: 'gnomAD', values: [{ text: '14-23429278-C-T' }] },
        { label: 'GRCh38', values: [{ text: 'NC_000014.9:g.23429278C>T' }] },
        { label: 'Protein', values: [{ text: 'NP_000248.2:p.Arg403Gln' }] },
      ],
      autoFill: true,
      warnings: [],
    });
  });

  it('leaves the ClinVar ID out when ClinVar has several variations', () => {
    const several = { ...myh7, clinVar: [...myh7.clinVar, { variationId: '2', url: 'u' }] };
    expect(toResolution(result([several])).candidates[0]!.fill).toEqual({
      caid: 'CA010365',
      gnomad: '14-23429278-C-T',
    });
  });

  it('auto-fills an assumed transcript only when the stated protein change confirms it', () => {
    expect(autoFill(result([{ ...myh7, proteinConfirmed: true }], assumed))).toEqual([true]);
    expect(autoFill(result([myh7], assumed))).toEqual([false]);
  });

  it('auto-fills despite no ClinVar record, but not despite other doubts', () => {
    const warn = (code: VariantCandidate['warnings'][number]['code']) => ({
      ...myh7,
      warnings: [{ code, message: code }],
    });
    expect(autoFill(result([warn('no-clinvar')]))).toEqual([true]);
    expect(autoFill(result([warn('protein-differs')]))).toEqual([false]);
  });

  it('does not auto-fill one of several candidates, or an unregistered allele', () => {
    expect(autoFill(result([myh7, { ...myh7, caid: 'CA2' }]))).toEqual([false, false]);
    const unregistered = { ...myh7 };
    delete unregistered.caid;
    expect(autoFill(result([unregistered]))).toEqual([false]);
    expect(toResolution(result([unregistered])).candidates[0]!.facts[0]).toEqual({
      label: 'CAID',
      values: [],
    });
  });

  it('does not auto-fill when the query had other warnings', () => {
    const r = result([myh7], [{ code: 'mapped', message: 'mapped' }]);
    expect(autoFill(r)).toEqual([false]);
  });
});
