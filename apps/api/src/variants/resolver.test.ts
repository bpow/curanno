import { describe, expect, it } from 'vitest';
import { fixtureFetch, loadRecordings, type Recording } from './fixture-fetch.js';
import { UpstreamError, VariantResolver, type VariantResolution } from './resolver.js';

const REGISTRY = 'https://reg.genome.network';
const VALIDATOR = 'https://rest.variantvalidator.org';

function resolver(recordings?: Record<string, Recording>, requested: string[] = []) {
  return new VariantResolver({
    registryUrl: REGISTRY,
    variantValidatorUrl: VALIDATOR,
    timeoutMs: 1000,
    fetch: fixtureFetch(recordings, requested),
  });
}

const codes = (r: VariantResolution) => r.warnings.map((w) => w.code);

describe('VariantResolver', () => {
  it('finds the CAID, ClinVar and gnomAD IDs of HGVS on a current transcript', async () => {
    const r = await resolver().resolve('NM_000257.4:c.1208G>A', 'MYH7');
    expect(r.warnings).toEqual([]);
    expect(r.candidates).toEqual([
      {
        caid: 'CA010365',
        registryUrl:
          'https://reg.clinicalgenome.org/redmine/projects/registry/genboree_registry/by_caid?caid=CA010365',
        title: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
        geneSymbol: 'MYH7',
        hgvs: {
          genomic: 'NC_000014.9:g.23429278C>T',
          transcript: 'NM_000257.4:c.1208G>A',
          protein: 'NP_000248.2:p.Arg403Gln',
        },
        clinVar: [
          { variationId: '14087', url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/14087/' },
        ],
        gnomad: '14-23429278-C-T',
        dbSnp: 'rs121913624',
        warnings: [],
      },
    ]);
    expect(r.steps).toEqual([
      { service: 'registry', request: 'NM_000257.4:c.1208G>A', outcome: 'found CA010365' },
    ]);
  });

  it('agrees with the protein change the article states', async () => {
    const r = await resolver().resolve('NM_000257.4(MYH7):c.1208G>A (p.R403Q)');
    expect(r.candidates[0]!.warnings).toEqual([]);
    expect(r.candidates[0]!.proteinConfirmed).toBe(true);
  });

  it.each([
    'NM_000257.4(MYBPC3):c.1208G>A (p.Arg403Gln)',
    'NM_000257.2(MYBPC3):c.1208G>A (p.Arg403Gln)',
    'NP_000248.2(MYBPC3):p.Arg403Gln',
  ])('flags a conflicting gene embedded in %s', async (query) => {
    // Check the article's gene even without context, or when context agrees with
    // the resolved allele. Repeated context and article genes need just one warning.
    for (const gene of [undefined, 'MYH7', 'MYBPC3']) {
      const r = await resolver().resolve(query, gene);
      expect(r.candidates[0]!.caid).toBe('CA010365');
      expect(r.candidates[0]!.warnings).toEqual([
        { code: 'gene-differs', message: 'This allele is in MYH7, not MYBPC3.' },
      ]);
    }
  });

  it('warns when the stated protein change does not follow', async () => {
    const r = await resolver().resolve('NM_000257.4:c.1208G>A (p.Arg403Trp)');
    expect(r.candidates[0]!.proteinConfirmed).toBeUndefined();
    expect(r.candidates[0]!.warnings.map((w) => w.code)).toEqual(['protein-differs']);
  });

  it('uses the MANE Select transcript for a cDNA change on its own', async () => {
    const r = await resolver().resolve('c.1208G>A', 'myh7');
    expect(r.gene).toBe('MYH7');
    expect(codes(r)).toEqual(['transcript-assumed']);
    expect(r.candidates.map((c) => c.caid)).toEqual(['CA010365']);
  });

  it('needs a gene for a cDNA change on its own', async () => {
    const r = await resolver().resolve('c.1208G>A');
    expect(codes(r)).toEqual(['gene-needed']);
    expect(r.candidates).toEqual([]);
  });

  it('assumes the MANE Select version of a MANE transcript', async () => {
    const r = await resolver().resolve('NM_000257:c.1208G>A', 'MYH7');
    expect(codes(r)).toEqual(['version-assumed']);
    expect(r.candidates.map((c) => c.caid)).toEqual(['CA010365']);
  });

  it('maps an old transcript version through VariantValidator', async () => {
    const r = await resolver().resolve('NM_000257.2:c.1208G>A', 'MYH7');
    expect(codes(r)).toEqual(['mapped']);
    expect(r.candidates.map((c) => c.caid)).toEqual(['CA010365']);
    expect(r.steps.map((s) => s.outcome)).toEqual([
      'reference sequence not known',
      'mapped to NC_000014.9:g.23429278C>T',
      'found CA010365',
    ]);
  });

  it('offers the current version too when an old one numbers the position differently', async () => {
    const r = await resolver().resolve('NM_000256.2:c.772G>A (p.Glu258Lys)', 'MYBPC3');
    expect(codes(r)).toEqual(['mapped', 'numbering-differs']);
    expect(r.candidates.map((c) => [c.caid, c.hgvs.transcript])).toEqual([
      ['CA380333965', 'NM_000256.3:c.780G>A'],
      ['CA015823', 'NM_000256.3:c.772G>A'],
    ]);
    // The stated protein change points to the second.
    expect(r.candidates[0]!.warnings.map((w) => w.code)).toEqual(['no-clinvar', 'protein-differs']);
    expect(r.candidates[1]!.warnings).toEqual([]);
  });

  it('gives no protein change for an intronic variant', async () => {
    const r = await resolver().resolve('NM_000256.3:c.3628-41_3628-17del');
    expect(r.candidates[0]!.hgvs).toEqual({
      genomic: expect.stringMatching(/^NC_000011\.10:g\./) as string,
      transcript: 'NM_000256.3:c.3628-41_3628-17del',
    });
  });

  it('reports a reference base that does not match', async () => {
    const r = await resolver().resolve('NM_000257.4:c.1208C>A', 'MYH7');
    expect(codes(r)).toEqual(['reference-mismatch']);
    expect(r.warnings[0]!.message).toContain('given=C, found=G');
    expect(r.candidates).toEqual([]);
  });

  it('offers registered cDNA changes for a protein change on its own', async () => {
    const r = await resolver().resolve('R403Q', 'MYH7');
    expect(codes(r)).toEqual(['protein-only']);
    expect(r.candidates.map((c) => c.caid)).toEqual(['CA010365']);
    expect(r.candidates[0]!.warnings).toEqual([]);
  });

  it('says when several cDNA changes produce a protein change', async () => {
    const recordings = loadRecordings();
    const key = `${REGISTRY}/allele?hgvs=${encodeURIComponent('NP_000248.2:p.Arg403Gln')}`;
    const protein = structuredClone(recordings[key]!.body) as {
      aminoAcidAlleles: { matchingRegisteredTranscripts: { '@id': string }[] }[];
    };
    protein.aminoAcidAlleles[0]!.matchingRegisteredTranscripts.push({
      '@id': 'http://reg.genome.network/allele/CA485625782',
    });
    recordings[key] = { status: 200, body: protein };
    recordings[`${REGISTRY}/allele/CA485625782`] =
      recordings[`${REGISTRY}/allele?hgvs=${encodeURIComponent('NM_000257.4:c.1209G>T')}`]!;
    const r = await resolver(recordings).resolve('p.Arg403Gln', 'MYH7');
    expect(codes(r)).toEqual(['protein-only', 'several-candidates']);
    expect(r.candidates.map((c) => c.caid)).toEqual(['CA010365', 'CA485625782']);
    // The second does not produce the protein change asked for.
    expect(r.candidates[1]!.warnings.map((w) => w.code)).toContain('protein-differs');
  });

  it('flags an allele nobody has registered', async () => {
    const r = await resolver().resolve('NM_000257.4:c.1208_1210del');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.caid).toBeUndefined();
    expect(r.candidates[0]!.hgvs.genomic).toBe('NC_000014.9:g.23429276_23429278del');
    expect(r.candidates[0]!.warnings.map((w) => w.code)).toEqual(['not-registered', 'no-clinvar']);
  });

  it('flags a registered allele that ClinVar does not have', async () => {
    const r = await resolver().resolve('NM_000257.4:c.1209G>T');
    expect(r.candidates[0]!.caid).toBe('CA485625782');
    expect(r.candidates[0]!.warnings.map((w) => w.code)).toEqual(['no-clinvar']);
  });

  it('does not offer the MANE numbering for a different transcript', async () => {
    const recordings = loadRecordings();
    const old = encodeURIComponent('NM_000256.2:c.772G>A');
    const other = encodeURIComponent('NM_999999.1:c.772G>A');
    for (const [url, recording] of Object.entries(recordings)) {
      if (url.includes(old)) recordings[url.replace(old, other)] = recording;
    }
    const r = await resolver(recordings).resolve('NM_999999.1:c.772G>A', 'MYBPC3');
    expect(codes(r)).toEqual(['mapped']);
    expect(r.candidates.map((c) => c.hgvs.transcript)).toEqual(['NM_000256.3:c.780G>A']);
  });

  it('says so when the registry does not know a protein sequence', async () => {
    const recordings = loadRecordings();
    const hgvs = (h: string) => `${REGISTRY}/allele?hgvs=${encodeURIComponent(h)}`;
    recordings[hgvs('NP_000248.1:p.Arg403Gln')] = recordings[hgvs('NM_000257.2:c.1208G>A')]!;
    const r = await resolver(recordings).resolve('NP_000248.1:p.Arg403Gln', 'MYH7');
    expect(codes(r)).toEqual(['not-mapped']);
    expect(r.candidates).toEqual([]);
  });

  it('looks a protein change on the MANE Select transcript up on its protein', async () => {
    const exact = await resolver().resolve('NM_000257.4:p.Arg403Gln', 'MYH7');
    expect(codes(exact)).toEqual(['protein-only']);
    expect(exact.candidates.map((c) => c.caid)).toEqual(['CA010365']);
    const unversioned = await resolver().resolve('NP_000248:p.R403Q', 'MYH7');
    expect(codes(unversioned)).toEqual(['version-assumed', 'protein-only']);
  });

  it('does not put a protein change on another sequence onto the MANE Select protein', async () => {
    const r = await resolver().resolve('NM_000256.3:p.Arg403Gln', 'MYH7');
    expect(codes(r)).toEqual(['version-needed']);
    expect(r.candidates).toEqual([]);
  });

  it('uses the gene the variant names rather than the gene of interest', async () => {
    const r = await resolver().resolve('MYH7:c.1208G>A', 'MYBPC3');
    expect(codes(r)).toEqual(['transcript-assumed']);
    expect(r.candidates[0]!.caid).toBe('CA010365');
    expect(r.candidates[0]!.warnings.map((w) => w.code)).toEqual(['gene-differs']);
  });

  it('asks for a gene symbol as HGNC writes it', async () => {
    const requested: string[] = [];
    await expect(resolver({}, requested).resolve('c.1A>G', 'c9ORF72')).rejects.toThrow();
    expect(requested).toEqual([`${REGISTRY}/gene?HGNC.symbol=C9orf72`]);
  });

  it('shares one lookup between callers asking at once', async () => {
    const requested: string[] = [];
    const lookup = resolver(undefined, requested);
    const [a, b] = await Promise.all([
      lookup.resolve('NM_000257.4:c.1208G>A'),
      lookup.resolve('NM_000257.4:c.1208G>A'),
    ]);
    expect(a).toBe(b);
    expect(requested).toHaveLength(1);
  });

  it('flags an allele outside the gene of interest', async () => {
    const r = await resolver().resolve('NC_000014.9:g.23429278C>T', 'TNNT2');
    expect(r.candidates[0]!.warnings.map((w) => w.code)).toEqual(['gene-differs']);
  });

  it('reports a gene the registry does not know', async () => {
    const r = await resolver().resolve('c.1A>G', 'NOTAGENE');
    expect(codes(r)).toEqual(['gene-unknown']);
  });

  it('reports text it does not understand without asking anyone', async () => {
    const requested: string[] = [];
    const r = await resolver(undefined, requested).resolve('IVS4+1G>A', 'MYH7');
    expect(codes(r)).toEqual(['not-understood']);
    expect(requested).toEqual([]);
  });

  it('throws when the registry cannot be reached', async () => {
    await expect(resolver({}).resolve('NM_000257.4:c.1208G>A')).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  describe.each([
    {
      name: 'allele',
      query: 'NM_000257.4:c.1208G>A',
      url: `${REGISTRY}/allele?hgvs=${encodeURIComponent('NM_000257.4:c.1208G>A')}`,
      malformed: [
        { genomicAlleles: [{}] },
        { transcriptAlleles: [null] },
        {
          genomicAlleles: [{ hgvs: ['NC_000014.9:g.23429278C>T'] }],
          externalRecords: { ClinVarVariations: {} },
        },
      ],
    },
    {
      name: 'allele by ID',
      query: 'p.Arg403Gln',
      url: `${REGISTRY}/allele/CA010365`,
      malformed: [{ genomicAlleles: [{ hgvs: [123] }] }],
    },
    {
      name: 'gene',
      query: 'c.1208G>A',
      url: `${REGISTRY}/gene?HGNC.symbol=MYH7`,
      malformed: [
        { externalRecords: {} },
        { externalRecords: { HGNC: { symbol: 'MYH7' }, MANE: {} } },
        { externalRecords: { HGNC: { symbol: 'MYH7' }, MANE: [null] } },
      ],
    },
    {
      name: 'mapping',
      query: 'NM_000257.2:c.1208G>A',
      url: `${VALIDATOR}/VariantValidator/variantvalidator/GRCh38/${encodeURIComponent('NM_000257.2:c.1208G>A')}/mane_select?content-type=application%2Fjson`,
      malformed: [
        { flag: 'gene_variant', metadata: {} },
        { flag: 'gene_variant', result: { validation_warnings: [123] } },
        {
          flag: 'gene_variant',
          result: { primary_assembly_loci: { grch38: { hgvs_genomic_description: 123 } } },
        },
      ],
    },
  ])('$name response validation', ({ query, url, malformed }) => {
    it.each([null, {}, [], 'invalid data', ...malformed].map((body) => ({ body })))(
      'rejects $body and retries after recovery',
      async ({ body }) => {
        const recordings = loadRecordings();
        const successful = recordings[url]!;
        recordings[url] = { status: 200, body };
        const lookup = resolver(recordings);
        await expect(lookup.resolve(query, 'MYH7')).rejects.toBeInstanceOf(UpstreamError);
        recordings[url] = successful;
        const recovered = await lookup.resolve(query, 'MYH7');
        expect(recovered.candidates[0]!.caid).toBe('CA010365');
      },
    );
  });

  it('rejects malformed registry errors instead of caching an unsuccessful lookup', async () => {
    const recordings = loadRecordings();
    const url = `${REGISTRY}/allele?hgvs=${encodeURIComponent('NM_000257.4:c.1208G>A')}`;
    const successful = recordings[url]!;
    recordings[url] = { status: 400, body: { message: { error: 'temporary failure' } } };
    const lookup = resolver(recordings);
    await expect(lookup.resolve('NM_000257.4:c.1208G>A')).rejects.toBeInstanceOf(UpstreamError);
    recordings[url] = successful;
    expect((await lookup.resolve('NM_000257.4:c.1208G>A')).candidates[0]!.caid).toBe('CA010365');
  });

  it('still reports a valid gene without MANE Select as gene-unknown', async () => {
    const recordings = loadRecordings();
    recordings[`${REGISTRY}/gene?HGNC.symbol=MYH7`] = {
      status: 200,
      body: { externalRecords: { HGNC: { symbol: 'MYH7' } } },
    };
    const r = await resolver(recordings).resolve('c.1208G>A', 'MYH7');
    expect(codes(r)).toEqual(['gene-unknown']);
  });

  it('still reports a valid VariantValidator rejection as a reference mismatch', async () => {
    const recordings = loadRecordings();
    const url = `${VALIDATOR}/VariantValidator/variantvalidator/GRCh38/${encodeURIComponent('NM_000257.2:c.1208G>A')}/mane_select?content-type=application%2Fjson`;
    recordings[url] = {
      status: 200,
      body: {
        flag: 'warning',
        result: {
          primary_assembly_loci: null,
          validation_warnings: ['ReferenceMismatchError: reference allele does not match'],
        },
      },
    };
    const r = await resolver(recordings).resolve('NM_000257.2:c.1208G>A');
    expect(codes(r)).toEqual(['reference-mismatch']);
    expect(r.candidates).toEqual([]);
  });

  it('reports a VariantValidator answer without results as not mapped', async () => {
    const recordings = loadRecordings();
    const url = `${VALIDATOR}/VariantValidator/variantvalidator/GRCh38/${encodeURIComponent('NM_000257.2:c.1208G>A')}/mane_select?content-type=application%2Fjson`;
    recordings[url] = { status: 200, body: { flag: 'empty_result', metadata: {} } };
    const r = await resolver(recordings).resolve('NM_000257.2:c.1208G>A');
    expect(codes(r)).toEqual(['not-mapped']);
  });

  it('ignores top-level VariantValidator fields it does not read', async () => {
    const recordings = loadRecordings();
    const url = `${VALIDATOR}/VariantValidator/variantvalidator/GRCh38/${encodeURIComponent('NM_000257.2:c.1208G>A')}/mane_select?content-type=application%2Fjson`;
    recordings[url] = {
      status: 200,
      body: { ...(recordings[url]!.body as Record<string, unknown>), notice: 'new field' },
    };
    const r = await resolver(recordings).resolve('NM_000257.2:c.1208G>A');
    expect(r.candidates[0]!.caid).toBe('CA010365');
  });

  it.each(['timeout', 408, 429, 503] as const)(
    'retries mapping after a temporary VariantValidator failure: %s',
    async (failure) => {
      const requested: string[] = [];
      const recorded = fixtureFetch(undefined, requested);
      let unavailable = true;
      const lookup = new VariantResolver({
        registryUrl: REGISTRY,
        variantValidatorUrl: VALIDATOR,
        timeoutMs: 1000,
        fetch: (input, init) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (url.startsWith(VALIDATOR) && unavailable) {
            if (failure === 'timeout') return Promise.reject(new Error('temporary timeout'));
            return Promise.resolve(new Response(JSON.stringify({}), { status: failure }));
          }
          return recorded(input, init);
        },
      });
      await expect(lookup.resolve('NM_000257.2:c.1208G>A', 'MYH7')).rejects.toBeInstanceOf(
        UpstreamError,
      );
      unavailable = false;
      const recovered = await lookup.resolve('NM_000257.2:c.1208G>A', 'MYH7');
      expect(recovered.candidates.map((c) => c.caid)).toEqual(['CA010365']);
      const count = requested.length;
      await lookup.resolve('NM_000257.2:c.1208G>A', 'MYH7');
      expect(requested).toHaveLength(count);
    },
  );

  it('retries registry lookups after throttling', async () => {
    const recordings = loadRecordings();
    const key = `${REGISTRY}/allele?hgvs=${encodeURIComponent('NM_000257.4:c.1208G>A')}`;
    const successful = recordings[key]!;
    recordings[key] = { status: 429, body: { message: 'Too Many Requests' } };
    const lookup = resolver(recordings);
    await expect(lookup.resolve('NM_000257.4:c.1208G>A')).rejects.toBeInstanceOf(UpstreamError);
    recordings[key] = successful;
    expect((await lookup.resolve('NM_000257.4:c.1208G>A')).candidates[0]!.caid).toBe('CA010365');
  });

  it('reuses a result for a day', async () => {
    const requested: string[] = [];
    let now = 0;
    const cached = new VariantResolver({
      registryUrl: REGISTRY,
      variantValidatorUrl: VALIDATOR,
      timeoutMs: 1000,
      fetch: fixtureFetch(undefined, requested),
      now: () => now,
    });
    await cached.resolve('NM_000257.4:c.1208G>A');
    await cached.resolve('NM_000257.4:c.1208G>A');
    expect(requested).toHaveLength(1);
    now = 25 * 60 * 60 * 1000;
    await cached.resolve('NM_000257.4:c.1208G>A');
    expect(requested).toHaveLength(2);
  });
});
