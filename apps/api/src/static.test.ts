/**
 * Operational plumbing: request ids, security headers, metrics, and the
 * clients served from the API process with their policies (ADR 0021).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alice, createTestContext, databaseUrl, type TestContext } from './test/harness.js';

function fakeClients(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'curanno-static-'));
  mkdirSync(path.join(root, 'sidebar', 'assets'), { recursive: true });
  mkdirSync(path.join(root, 'pdf'), { recursive: true });
  writeFileSync(path.join(root, 'sidebar', 'index.html'), '<!doctype html><title>Sidebar</title>');
  writeFileSync(path.join(root, 'sidebar', 'assets', 'app.js'), 'console.log("sidebar")');
  writeFileSync(path.join(root, 'sidebar', 'config.json'), '{"oidcIssuer":"from-the-build"}');
  writeFileSync(path.join(root, 'pdf', 'index.html'), '<!doctype html><title>Viewer</title>');
  writeFileSync(path.join(root, 'guest.js'), '(() => {})()');
  return root;
}

describe.skipIf(!databaseUrl)('operational plumbing', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({
      config: {
        staticRoot: fakeClients(),
        frameAncestors: ["'self'", 'https://pages.example'],
        pdfViewerOrigin: 'https://pdf.annotations.test',
      },
    });
  });
  afterAll(() => ctx.close());

  it('gives every response a request id, its own or the proxy’s', async () => {
    const fresh = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const forwarded = await ctx.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'edge-42' },
    });
    expect(forwarded.headers['x-request-id']).toBe('edge-42');
  });

  it('sends security headers on API responses, and no caching of authenticated ones', async () => {
    const anonymous = await ctx.app.inject({ method: 'GET', url: '/x/profiles' });
    expect(anonymous.headers['x-content-type-options']).toBe('nosniff');
    expect(anonymous.headers['referrer-policy']).toBe('no-referrer');
    expect(anonymous.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(anonymous.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(anonymous.headers['cache-control']).toBeUndefined();
    const me = await ctx.as(alice, { method: 'GET', url: '/x/me' });
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('exposes Prometheus metrics with request durations by route', async () => {
    await ctx.as(alice, { method: 'GET', url: '/x/me' });
    const res = await ctx.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('process_cpu_user_seconds_total');
    expect(res.body).toMatch(
      /http_request_duration_seconds_count\{[^}]*route="\/x\/me"[^}]*status="200"/,
    );
    expect(res.body).toContain('curanno_event_streams_open 0');
    // Route patterns, never identifiers.
    expect(res.body).not.toContain('/x/users/');
  });

  it('serves the sidebar with its policy and a config.json from the environment', async () => {
    const page = await ctx.app.inject({ method: 'GET', url: '/sidebar/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Sidebar</title>');
    const policy = page.headers['content-security-policy'] as string;
    expect(policy).toContain(
      "frame-ancestors 'self' https://pages.example https://pdf.annotations.test",
    );
    expect(policy).toContain("script-src 'self' 'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' https://idp.test");
    expect(policy).toContain('frame-src https://idp.test');
    const asset = await ctx.app.inject({ method: 'GET', url: '/sidebar/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toMatch(/javascript/);
    // The deployment's configuration wins over the file the build shipped.
    const config = await ctx.app.inject({ method: 'GET', url: '/sidebar/config.json' });
    expect(config.json()).toEqual({
      oidcIssuer: 'https://idp.test',
      oidcClientId: 'curanno-sidebar',
      apiUrl: '',
      pdfViewerOrigin: 'https://pdf.annotations.test',
    });
    expect(config.headers['cache-control']).toBe('no-store');
  });

  it('serves the viewer for its own host only, pointing at the sidebar', async () => {
    const wrongHost = await ctx.app.inject({ method: 'GET', url: '/pdf/' });
    expect(wrongHost.statusCode).toBe(404);
    const viewer = await ctx.app.inject({
      method: 'GET',
      url: '/pdf/',
      headers: { host: 'pdf.annotations.test' },
    });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.body).toContain('<title>Viewer</title>');
    const policy = viewer.headers['content-security-policy'] as string;
    expect(policy).toContain('connect-src *');
    expect(policy).toContain('frame-src https://annotations.test');
    expect(policy).toContain("worker-src 'self' blob:");
    const config = await ctx.app.inject({
      method: 'GET',
      url: '/pdf/config.json',
      headers: { host: 'pdf.annotations.test' },
    });
    expect(config.json()).toEqual({
      sidebarOrigin: 'https://annotations.test',
      sidebarPath: '/sidebar/',
    });
  });

  it('serves the guest bundle', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/guest.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body).toBe('(() => {})()');
  });
});
