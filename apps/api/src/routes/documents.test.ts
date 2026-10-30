import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alice,
  annotationOn,
  createTestContext,
  databaseUrl,
  type TestContext,
} from '../test/harness.js';

describe.skipIf(!databaseUrl)('documents', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('registers, extends and looks up documents', async () => {
    const first = await ctx.as(alice, {
      method: 'POST',
      url: '/x/documents',
      payload: { uri: 'https://example.org/post?utm_source=x', title: 'A post', links: [] },
    });
    expect(first.statusCode).toBe(201);
    const doc = first.json<{
      id: string;
      uris: { uri: string; relation: string }[];
      title: string;
    }>();
    expect(doc.title).toBe('A post');
    expect(doc.uris).toEqual([{ uri: 'https://example.org/post?utm_source=x', relation: 'self' }]);

    const again = await ctx.as(alice, {
      method: 'POST',
      url: '/x/documents',
      payload: {
        uri: 'http://example.org/post',
        links: [
          { uri: '/short/p1', relation: 'shortlink' },
          { uri: 'https://example.org/', relation: 'canonical' },
          { uri: 'https://feeds.example.org/post', relation: 'alternate' },
        ],
      },
    });
    expect(again.statusCode).toBe(200);
    const extended = again.json<{ id: string; uris: { relation: string }[] }>();
    expect(extended.id).toBe(doc.id);
    expect(extended.uris.map((u) => u.relation).sort()).toEqual(['self', 'shortlink']);

    const lookup = await ctx.as(alice, {
      method: 'GET',
      url: `/x/documents?uri=${encodeURIComponent('https://example.org/short/p1')}`,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json<{ id: string }>().id).toBe(doc.id);
    const byId = await ctx.as(alice, { method: 'GET', url: `/x/documents/${doc.id}` });
    expect(byId.statusCode).toBe(200);
    const missing = await ctx.as(alice, {
      method: 'GET',
      url: `/x/documents?uri=${encodeURIComponent('https://example.org/nothing')}`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('does not merge documents already recorded as distinct when a page links them', async () => {
    const a = await ctx.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: { 'content-type': 'application/ld+json' },
      payload: annotationOn('https://a.example/paper'),
    });
    const b = await ctx.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: { 'content-type': 'application/ld+json' },
      payload: annotationOn('https://b.example/mirror/paper'),
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    const docA = await ctx.as(alice, {
      method: 'GET',
      url: `/x/documents?uri=${encodeURIComponent('https://a.example/paper')}`,
    });
    const docB = await ctx.as(alice, {
      method: 'GET',
      url: `/x/documents?uri=${encodeURIComponent('https://b.example/mirror/paper')}`,
    });
    expect(docA.json<{ id: string }>().id).not.toBe(docB.json<{ id: string }>().id);

    // A page at b claims a is its canonical URL. Both documents exist already, so
    // nothing is merged: the page keeps its own document and a keeps its annotations.
    const claimed = await ctx.as(alice, {
      method: 'POST',
      url: '/x/documents',
      payload: {
        uri: 'https://b.example/mirror/paper',
        links: [{ uri: 'https://a.example/paper', relation: 'canonical' }],
      },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json<{ id: string }>().id).toBe(docB.json<{ id: string }>().id);
    const stillA = await ctx.as(alice, {
      method: 'GET',
      url: `/x/documents/${docA.json<{ id: string }>().id}`,
    });
    expect(stillA.statusCode).toBe(200);
    const search = await ctx.as(alice, {
      method: 'GET',
      url: `/x/search?uri=${encodeURIComponent('https://a.example/paper')}`,
    });
    expect(search.json<{ total: number }>().total).toBe(1);

    // A link to a URI nobody has recorded extends the page's document.
    const extended = await ctx.as(alice, {
      method: 'POST',
      url: '/x/documents',
      payload: {
        uri: 'https://b.example/mirror/paper',
        links: [{ uri: 'https://c.example/copy/paper', relation: 'canonical' }],
      },
    });
    expect(extended.statusCode).toBe(200);
    const viaC = await ctx.as(alice, {
      method: 'GET',
      url: `/x/documents?uri=${encodeURIComponent('https://c.example/copy/paper')}`,
    });
    expect(viaC.json<{ id: string }>().id).toBe(docB.json<{ id: string }>().id);
  });

  it('rejects metadata without a usable URI', async () => {
    const res = await ctx.as(alice, {
      method: 'POST',
      url: '/x/documents',
      payload: { uri: 'about:blank', links: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
