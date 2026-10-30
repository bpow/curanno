/**
 * Server plumbing: health routes, OPTIONS, problem details, media types and
 * the strictness of request validation (ADR 0011).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alice,
  annotationOn,
  createTestContext,
  databaseUrl,
  type TestContext,
} from './test/harness.js';

describe.skipIf(!databaseUrl)('server', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('answers the health and readiness checks', async () => {
    const health = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok' });
    const ready = await ctx.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
  });

  it('answers OPTIONS with Allow for documented paths', async () => {
    const res = await ctx.app.inject({ method: 'OPTIONS', url: '/annotations/' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['allow']).toBe('GET, HEAD, OPTIONS, POST');
  });

  it('returns problem details for unknown routes and bad tokens', async () => {
    const missing = await ctx.app.inject({ method: 'GET', url: '/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(missing.json()).toMatchObject({ title: 'Not Found', status: 404 });

    const bad = await ctx.app.inject({
      method: 'GET',
      url: '/x/me',
      headers: { authorization: 'Bearer not-a-token' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['www-authenticate']).toMatch(/^Bearer/);
    expect(bad.json()).toMatchObject({ status: 401 });
  });

  it('rejects schema violations with Ajv-shaped errors and does not coerce bodies', async () => {
    const res = await ctx.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: { 'content-type': 'application/ld+json' },
      payload: {
        ...annotationOn('https://example.org/page'),
        target: {
          source: 'https://example.org/page',
          selector: { type: 'TextPositionSelector', start: '1', end: 2 },
        },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ errors: { instancePath: string }[] }>();
    expect(body.errors.some((e) => e.instancePath.includes('/target'))).toBe(true);
  });

  it('keeps unknown JSON-LD properties instead of stripping them', async () => {
    const res = await ctx.as(alice, {
      method: 'POST',
      url: '/annotations/',
      headers: { 'content-type': 'application/ld+json' },
      payload: annotationOn('https://example.org/page', 'hi', {
        'https://example.org/vocab#severity': 'high',
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ 'https://example.org/vocab#severity': 'high' });
  });
});
