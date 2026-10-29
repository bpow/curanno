import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('server', () => {
  const app = buildServer();
  afterAll(() => app.close());

  it('answers the health check', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});
