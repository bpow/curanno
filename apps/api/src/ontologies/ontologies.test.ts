import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, databaseUrl, type TestContext } from '../test/harness.js';
import { hpoFixture } from '../test/hpo-fixture.js';
import { parseOboGraph } from './obographs.js';
import { importOntology } from './service.js';

describe('parseOboGraph', () => {
  const parsed = parseOboGraph(hpoFixture, 'HP');

  it('reads the release and keeps current classes of its own prefix', () => {
    expect(parsed).toMatchObject({
      title: 'Human Phenotype Ontology',
      version: '2026-09-01',
      license: 'https://hpo.jax.org/app/license',
      homepage: undefined,
    });
    const ids = parsed.terms.map((t) => t.id);
    expect(ids).toContain('HP:0001639');
    expect(ids).not.toContain('HP:0009999');
    expect(ids).not.toContain('GO:0007507');
  });

  it('keeps exact and related synonyms and every is_a ancestor', () => {
    expect(parsed.terms.find((t) => t.id === 'HP:0001639')).toEqual({
      id: 'HP:0001639',
      label: 'Hypertrophic cardiomyopathy',
      synonyms: ['HCM', 'Enlarged and thickened heart muscle'],
      ancestors: ['HP:0000001', 'HP:0000118', 'HP:0001638'],
    });
  });

  it('rejects a document that is not OBO Graphs', () => {
    expect(() => parseOboGraph({ nodes: [] }, 'HP')).toThrow(/OBO Graphs/);
  });
});

describe.skipIf(!databaseUrl)('ontology term search', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
    await importOntology(ctx.db, 'hp', {
      ...parseOboGraph(hpoFixture, 'HP'),
      homepage: 'http://www.human-phenotype-ontology.org',
    });
  });
  afterAll(() => ctx.close());

  const search = async (query: string) => {
    const res = await ctx.as(null, { method: 'GET', url: `/x/ontologies/hp/terms?${query}` });
    return { status: res.statusCode, body: res.json<{ id: string; synonym?: string }[]>() };
  };

  it('lists the loaded release', async () => {
    const res = await ctx.as(null, { method: 'GET', url: '/x/ontologies' });
    expect(res.json()).toMatchObject([
      {
        name: 'hp',
        title: 'Human Phenotype Ontology',
        version: '2026-09-01',
        homepage: 'http://www.human-phenotype-ontology.org',
        terms: 6,
      },
    ]);
  });

  it('ranks a name prefix before a match inside a word', async () => {
    const { body } = await search('q=cardiomyo');
    expect(body.map((t) => t.id)).toEqual(['HP:0001638', 'HP:0001639']);
  });

  it('matches synonyms, every word in any order, and IDs', async () => {
    expect((await search('q=hcm')).body).toEqual([
      { id: 'HP:0001639', label: 'Hypertrophic cardiomyopathy', synonym: 'HCM' },
    ]);
    expect((await search('q=heart%20enlarged')).body.map((t) => t.id)).toEqual(['HP:0001639']);
    expect((await search('q=HP:0000006')).body.map((t) => t.id)).toEqual(['HP:0000006']);
    expect((await search('q=heart%20disease')).body).toEqual([]);
  });

  it('stays within a branch when given a root', async () => {
    expect((await search('q=autosomal')).body.map((t) => t.id)).toEqual(['HP:0000006']);
    expect((await search('q=autosomal&root=HP:0000118')).body).toEqual([]);
    expect((await search('q=phenotypic&root=HP:0000118')).body.map((t) => t.id)).toEqual([
      'HP:0000118',
    ]);
  });

  it('treats LIKE wildcards literally and answers 404 for an ontology not loaded', async () => {
    expect((await search('q=%25')).body).toEqual([]);
    const res = await ctx.as(null, { method: 'GET', url: '/x/ontologies/mondo/terms?q=x' });
    expect(res.statusCode).toBe(404);
  });
});
