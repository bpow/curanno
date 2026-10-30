/**
 * `/x/search`: document identity including equivalent URIs, full text over
 * bodies and quotes, the filters the OpenAPI document defines, paging and
 * totals. Permission filtering is covered in acl.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROFILE_BASE } from '@scale/model';
import {
  alice,
  annotationOn,
  bob,
  createTestContext,
  databaseUrl,
  type TestContext,
} from '../test/harness.js';

const PAGE = 'https://journal.example/article/42?utm_campaign=x';
const LD_JSON = { 'content-type': 'application/ld+json' };

describe.skipIf(!databaseUrl)('search', () => {
  let ctx: TestContext;
  let documentId: string;
  const ids: string[] = [];

  const search = async (query: string) => {
    const res = await ctx.as(alice, { method: 'GET', url: `/x/search?${query}` });
    expect(res.statusCode).toBe(200);
    return res.json<{ total: number; items: { id: string; body?: { value?: string } }[] }>();
  };

  beforeAll(async () => {
    ctx = await createTestContext();
    const registered = await ctx.as(alice, {
      method: 'POST',
      url: '/x/documents',
      payload: {
        uri: PAGE,
        title: 'Article 42',
        links: [
          { uri: 'https://doi.org/10.1000/xyz42', relation: 'canonical' },
          { uri: '10.1000/XYZ42', relation: 'doi' },
        ],
      },
    });
    expect(registered.statusCode).toBe(201);
    documentId = registered.json<{ id: string }>().id;

    const inputs = [
      annotationOn(PAGE, 'The mitochondria is the powerhouse of the cell'),
      annotationOn(PAGE, 'Segregation analysis supports pathogenicity', {
        motivation: 'classifying',
        body: {
          type: 'StructuredBody',
          profile: `${PROFILE_BASE}evidence-excerpt/1`,
          purpose: 'classifying',
          value: { kind: 'segregation' },
        },
      }),
      annotationOn(PAGE, 'tagged', {
        motivation: 'tagging',
        body: { type: 'TextualBody', value: 'review', purpose: 'tagging' },
      }),
      annotationOn('https://elsewhere.example/other', 'unrelated powerhouse talk'),
    ];
    for (const [i, input] of inputs.entries()) {
      const res = await ctx.as(i === 3 ? bob : alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: input,
      });
      expect(res.statusCode).toBe(201);
      ids.push(res.json<{ id: string }>().id);
      await ctx.as(i === 3 ? bob : alice, {
        method: 'POST',
        url: `/x/annotations/${ids[i]?.split('/').pop()}/acl`,
        payload: { principal: '00000000-0000-0000-0000-000000000001', permission: 'read' },
      });
    }
    const orphaned = annotationOn(PAGE, 'lost its anchor');
    (orphaned.target as Record<string, unknown>)['anchoring'] = { state: 'orphaned' };
    const res = await ctx.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: LD_JSON,
      payload: orphaned,
    });
    expect(res.statusCode).toBe(201);
    ids.push(res.json<{ id: string }>().id);
  });
  afterAll(() => ctx.close());

  it('finds a document by any of its equivalent URIs', async () => {
    for (const uri of [
      PAGE,
      'http://journal.example/article/42',
      'https://doi.org/10.1000/xyz42',
      'doi:10.1000/xyz42',
    ]) {
      const result = await search(`uri=${encodeURIComponent(uri)}`);
      expect(result.total, uri).toBe(4);
    }
    expect((await search(`document=${documentId}`)).total).toBe(4);
    expect((await search(`uri=${encodeURIComponent('https://nowhere.example/')}`)).total).toBe(0);
  });

  it('searches bodies and quotes with Postgres full text', async () => {
    const bodies = await search('text=powerhouse');
    expect(bodies.total).toBe(2);
    const scoped = await search(`text=powerhouse&uri=${encodeURIComponent(PAGE)}`);
    expect(scoped.total).toBe(1);
    expect(scoped.items[0]?.body?.value).toMatch(/mitochondria/);
    const stemmed = await search('text=powerhouses');
    expect(stemmed.total).toBe(2);
    const quotes = await search('text=quoted');
    expect(quotes.total).toBe(5);
    const phrase = await search(`text=${encodeURIComponent('"powerhouse of the cell"')}`);
    expect(phrase.total).toBe(1);
  });

  it('applies the documented filters', async () => {
    expect((await search('motivation=tagging')).total).toBe(1);
    expect((await search('purpose=classifying')).total).toBe(1);
    expect(
      (await search(`profile=${encodeURIComponent(`${PROFILE_BASE}evidence-excerpt/1`)}`)).total,
    ).toBe(1);
    expect((await search('state=orphaned')).total).toBe(1);
    const me = await ctx.as(bob, { method: 'GET', url: '/x/me' });
    expect((await search(`creator=${me.json<{ id: string }>().id}`)).total).toBe(1);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await search(`since=${encodeURIComponent(future)}`)).total).toBe(0);
    expect((await search(`until=${encodeURIComponent(future)}`)).total).toBe(5);
  });

  it('pages with offset and a total, in either order', async () => {
    const page = await search('limit=2&offset=1&sort=created&order=asc');
    expect(page.total).toBe(5);
    expect(page.items.map((i) => i.id)).toEqual(ids.slice(1, 3));
    const desc = await search('limit=1');
    expect(desc.items[0]?.id).toBe(ids[4]);
    const bad = await ctx.as(alice, { method: 'GET', url: '/x/search?limit=0' });
    expect(bad.statusCode).toBe(400);
  });
});
