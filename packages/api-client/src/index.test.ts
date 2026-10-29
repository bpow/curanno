import { describe, expect, it } from 'vitest';
import { createApiClient, type Annotation } from './index.js';

describe('createApiClient', () => {
  it('sends the bearer token and types the response', async () => {
    const seen: Request[] = [];
    const annotation: Annotation = {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      id: 'https://api.example/annotations/1',
      type: 'Annotation',
      target: 'https://example.org/page',
    };
    const client = createApiClient({
      baseUrl: 'https://api.example',
      token: () => 'secret',
      fetch: (input) => {
        seen.push(input as Request);
        return Promise.resolve(
          new Response(JSON.stringify(annotation), {
            headers: { 'content-type': 'application/ld+json' },
          }),
        );
      },
    });
    const { data, response } = await client.GET('/annotations/{id}', {
      params: { path: { id: '1' } },
    });
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer secret');
    expect(seen[0]?.url).toBe('https://api.example/annotations/1');
    expect(response.status).toBe(200);
    expect(data?.id).toBe(annotation.id);
  });

  it('sends no Authorization header without a token', async () => {
    const seen: Request[] = [];
    const client = createApiClient({
      baseUrl: 'https://api.example',
      fetch: (input) => {
        seen.push(input as Request);
        return Promise.resolve(
          new Response('[]', { headers: { 'content-type': 'application/json' } }),
        );
      },
    });
    await client.GET('/x/profiles');
    expect(seen[0]?.headers.has('authorization')).toBe(false);
  });
});
