/** Lookup through the API (ADR 0039); the variant resolver itself is tested in src/variants. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alice, createTestContext, databaseUrl, type TestContext } from '../test/harness.js';

describe.skipIf(!databaseUrl)('variant lookup turned off', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({
      config: {
        variantLookup: {
          enabled: false,
          registryUrl: 'https://reg.genome.network',
          variantValidatorUrl: 'https://rest.variantvalidator.org',
          timeoutMs: 1000,
        },
      },
    });
  });
  afterAll(() => ctx.close());

  it('answers 404', async () => {
    const res = await ctx.as(alice, { method: 'GET', url: '/x/resolve/variant?q=c.1A%3EG' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ detail: string }>().detail).toMatch(/turned off/);
  });
});

describe.skipIf(!databaseUrl)('variant lookup', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('lets a browser reuse a result for an hour', async () => {
    const res = await ctx.as(alice, {
      method: 'GET',
      url: `/x/resolve/variant?q=${encodeURIComponent('NM_000257.4:c.1208G>A')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('passes the context on and says how it was used', async () => {
    const res = await ctx.as(alice, {
      method: 'GET',
      url: `/x/resolve/variant?q=${encodeURIComponent('c.1208G>A')}&gene=myh7`,
    });
    expect(res.json<{ context: Record<string, string> }>().context).toEqual({ gene: 'MYH7' });
  });

  it('refuses a gene that is not an HGNC symbol', async () => {
    const res = await ctx.as(alice, {
      method: 'GET',
      url: '/x/resolve/variant?q=c.1A%3EG&gene=not%20a%20gene',
    });
    expect(res.statusCode).toBe(400);
  });
});
