import { describe, expect, it } from 'vitest';
import { formatHgvs, normalizeProteinChange, parseVariant } from './parse.js';

function parsed(text: string) {
  const result = parseVariant(text);
  if (!result.ok) throw new Error(result.reason);
  return result.variant;
}

describe('parseVariant', () => {
  it('reads HGVS on a versioned transcript', () => {
    expect(parsed('NM_000257.4:c.1208G>A')).toEqual({
      reference: { accession: 'NM_000257', version: '4' },
      coordinate: 'c',
      change: 'c.1208G>A',
    });
  });

  it('reads the ClinVar-style name with its gene and protein change', () => {
    expect(parsed('NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)')).toEqual({
      reference: { accession: 'NM_000257', version: '4' },
      gene: 'MYH7',
      coordinate: 'c',
      change: 'c.1208G>A',
      statedProtein: 'p.Arg403Gln',
    });
  });

  it('reads a protein change after a semicolon, in one-letter code', () => {
    expect(parsed('c.1208G>A; p.(R403Q)')).toMatchObject({
      change: 'c.1208G>A',
      statedProtein: 'p.Arg403Gln',
    });
  });

  it('keeps a transcript without a version', () => {
    expect(parsed('NM_000257:c.1208G>A').reference).toEqual({ accession: 'NM_000257' });
  });

  it('reads a gene symbol in place of a reference', () => {
    expect(parsed('myh7:c.1208G>A')).toEqual({
      gene: 'MYH7',
      coordinate: 'c',
      change: 'c.1208G>A',
    });
  });

  it('undoes what copying from a page does', () => {
    expect(parsed(' “c.1208 G → A”. ').change).toBe('c.1208G>A');
    expect(parsed('c.1208G&gt;A').change).toBe('c.1208G>A');
    expect(parsed('c.1208_1210del').change).toBe('c.1208_1210del');
  });

  it('reads genomic and Ensembl HGVS', () => {
    expect(parsed('NC_000014.9:g.23429278C>T')).toMatchObject({
      reference: { accession: 'NC_000014', version: '9' },
      coordinate: 'g',
    });
    expect(parsed('ENST00000355349.4:c.1208G>A').reference).toEqual({
      accession: 'ENST00000355349',
      version: '4',
    });
  });

  it('reads a protein change on its own', () => {
    for (const text of ['R403Q', 'p.R403Q', 'Arg403Gln', 'p.(Arg403Gln)']) {
      expect(parsed(text)).toEqual({ coordinate: 'p', change: 'p.Arg403Gln' });
    }
    expect(parsed('R403*').change).toBe('p.Arg403Ter');
    expect(parsed('R403X').change).toBe('p.Arg403Ter');
    expect(parsed('NP_000248.2:p.Arg403Gln')).toEqual({
      reference: { accession: 'NP_000248', version: '2' },
      coordinate: 'p',
      change: 'p.Arg403Gln',
    });
  });

  it('does not take a nucleotide change in old notation for a protein change', () => {
    expect(parseVariant('G1208A').ok).toBe(false);
  });

  it('says when it does not understand the text', () => {
    for (const text of ['', 'IVS4+1G>A', 'exon 3-5 deletion', 'MYH7.2:c.1A>G']) {
      expect(parseVariant(text).ok).toBe(false);
    }
  });
});

describe('normalizeProteinChange', () => {
  it('writes substitutions in three-letter code without parentheses', () => {
    expect(normalizeProteinChange('p.(R403Q)')).toBe('p.Arg403Gln');
    expect(normalizeProteinChange('p.Arg403=')).toBe('p.Arg403=');
  });

  it('leaves other changes alone', () => {
    expect(normalizeProteinChange('p.(Arg403_Val404delinsLeu)')).toBe('p.Arg403_Val404delinsLeu');
  });
});

describe('formatHgvs', () => {
  it('joins a reference and a change', () => {
    expect(formatHgvs({ accession: 'NM_000257', version: '4' }, 'c.1A>G')).toBe(
      'NM_000257.4:c.1A>G',
    );
    expect(formatHgvs({ accession: 'NM_000257' }, 'c.1A>G')).toBe('NM_000257:c.1A>G');
  });
});
