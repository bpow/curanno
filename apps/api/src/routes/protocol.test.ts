/**
 * W3C Web Annotation Protocol behaviour: resources with ETags and
 * conditional requests, the container with paging, `iris` and `Prefer`,
 * media types and Link headers, and the validation of structured bodies
 * (success criteria 2 and 3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROFILE_BASE } from '@scale/model';
import {
  alice,
  annotationOn,
  bob,
  createTestContext,
  databaseUrl,
  PUBLIC_URL,
  type TestContext,
} from '../test/harness.js';

const PAGE = 'https://example.org/articles/1';
const LD_JSON = { 'content-type': 'application/ld+json' };

describe.skipIf(!databaseUrl)('W3C protocol', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  describe('annotation resources', () => {
    let id: string;
    let etag: string;

    it('creates an annotation with server-assigned properties and protocol headers', async () => {
      const res = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'First'),
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['content-type']).toMatch(
        /^application\/ld\+json; profile="http:\/\/www\.w3\.org\/ns\/anno\.jsonld"/,
      );
      expect(res.headers['link']).toBe('<http://www.w3.org/ns/ldp#Resource>; rel="type"');
      expect(res.headers['etag']).toMatch(/^"\d+"$/);
      const body = res.json<Record<string, unknown>>();
      expect(res.headers['location']).toBe(body['id']);
      expect(body['id']).toMatch(new RegExp(`^${PUBLIC_URL}/annotations/[0-9a-f-]{36}$`));
      expect(body['@context']).toEqual([
        'http://www.w3.org/ns/anno.jsonld',
        'https://scale.example/ns/anno.jsonld',
      ]);
      expect(body['creator']).toMatchObject({ type: 'Person', name: 'Alice Annotator' });
      expect(body['created']).toBe(body['modified']);
      expect(body['permissions']).toEqual(['delete', 'read', 'share', 'update']);
      expect(body['target']).toMatchObject({
        type: 'SpecificResource',
        source: PAGE,
        anchoring: { state: 'anchored' },
      });
      id = (body['id'] as string).split('/').pop() as string;
      etag = res.headers['etag'] as string;
    });

    it('reads it back in either media type', async () => {
      const ld = await ctx.as(alice, { method: 'GET', url: `/annotations/${id}` });
      expect(ld.statusCode, ld.body).toBe(200);
      expect(ld.headers['etag']).toBe(etag);
      expect(ld.headers['allow']).toBe('GET, HEAD, OPTIONS, PUT, DELETE');
      const json = await ctx.as(alice, {
        method: 'GET',
        url: `/annotations/${id}`,
        headers: { accept: 'application/json' },
      });
      expect(json.headers['content-type']).toMatch(/^application\/json/);
      expect(json.json()).toEqual(ld.json());
      const head = await ctx.as(alice, { method: 'HEAD', url: `/annotations/${id}` });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
    });

    it('requires If-Match to update and rejects a stale one', async () => {
      const missing = await ctx.as(alice, {
        method: 'PUT',
        url: `/annotations/${id}`,
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'Second'),
      });
      expect(missing.statusCode).toBe(428);
      const stale = await ctx.as(alice, {
        method: 'PUT',
        url: `/annotations/${id}`,
        headers: { ...LD_JSON, 'if-match': '"999"' },
        payload: annotationOn(PAGE, 'Second'),
      });
      expect(stale.statusCode).toBe(412);
    });

    it('replaces the annotation, bumps the ETag and keeps the original selector', async () => {
      const res = await ctx.as(alice, {
        method: 'PUT',
        url: `/annotations/${id}`,
        headers: { ...LD_JSON, 'if-match': etag },
        payload: annotationOn(PAGE, 'Second'),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['etag']).not.toBe(etag);
      const body = res.json<{ body: { value: string }; created: string; modified: string }>();
      expect(body.body.value).toBe('Second');
      expect(body.modified > body.created).toBe(true);
      etag = res.headers['etag'] as string;

      const changed = annotationOn(PAGE, 'Third');
      changed.target.selector = [{ type: 'TextQuoteSelector', exact: 'other words' }] as never;
      const rejected = await ctx.as(alice, {
        method: 'PUT',
        url: `/annotations/${id}`,
        headers: { ...LD_JSON, 'if-match': etag },
        payload: changed,
      });
      expect(rejected.statusCode).toBe(422);
      expect(rejected.json<{ detail: string }>().detail).toMatch(/immutable/);

      const repaired = annotationOn(PAGE, 'Third');
      (repaired.target as Record<string, unknown>)['anchoring'] = {
        state: 'repaired',
        repair: {
          selector: { type: 'TextQuoteSelector', exact: 'other words' },
          created: new Date().toISOString(),
        },
      };
      const ok = await ctx.as(alice, {
        method: 'PUT',
        url: `/annotations/${id}`,
        headers: { ...LD_JSON, 'if-match': etag },
        payload: repaired,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json<{ target: { anchoring: { state: string } } }>().target.anchoring.state).toBe(
        'repaired',
      );
      etag = ok.headers['etag'] as string;
    });

    it('answers 410 after deletion', async () => {
      const noMatch = await ctx.as(alice, { method: 'DELETE', url: `/annotations/${id}` });
      expect(noMatch.statusCode).toBe(428);
      const res = await ctx.as(alice, {
        method: 'DELETE',
        url: `/annotations/${id}`,
        headers: { 'if-match': etag },
      });
      expect(res.statusCode).toBe(204);
      const gone = await ctx.as(alice, { method: 'GET', url: `/annotations/${id}` });
      expect(gone.statusCode).toBe(410);
      const again = await ctx.as(alice, {
        method: 'DELETE',
        url: `/annotations/${id}`,
        headers: { 'if-match': '*' },
      });
      expect(again.statusCode).toBe(410);
    });

    it('answers 404 for unknown annotations and 401 for anonymous writes', async () => {
      const res = await ctx.as(alice, {
        method: 'GET',
        url: '/annotations/00000000-0000-0000-0000-000000000009',
      });
      expect(res.statusCode).toBe(404);
      const anon = await ctx.as(null, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE),
      });
      expect(anon.statusCode).toBe(401);
    });

    it('round-trips IRI targets, external targets and replies', async () => {
      const parent = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: {
          type: 'Annotation',
          target: [PAGE, { id: 'https://example.org/img.png', format: 'image/png' }],
        },
      });
      expect(parent.statusCode).toBe(201);
      const parentBody = parent.json<{ id: string; target: unknown }>();
      expect(parentBody.target).toEqual([
        PAGE,
        { id: 'https://example.org/img.png', format: 'image/png' },
      ]);

      const reply = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: {
          type: 'Annotation',
          motivation: 'replying',
          bodyValue: 'I agree',
          target: parentBody.id,
        },
      });
      expect(reply.statusCode).toBe(201);
      expect(reply.json()).toMatchObject({
        motivation: 'replying',
        bodyValue: 'I agree',
        target: parentBody.id,
      });
      const parentId = parentBody.id.split('/').pop() as string;
      const replies = await ctx.as(alice, { method: 'GET', url: `/x/search?parent=${parentId}` });
      expect(replies.json<{ total: number }>().total).toBe(1);

      const orphan = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: {
          type: 'Annotation',
          motivation: 'replying',
          target: `${PUBLIC_URL}/annotations/00000000-0000-0000-0000-000000000009`,
        },
      });
      expect(orphan.statusCode).toBe(422);
    });
  });

  describe('structured bodies', () => {
    const profile = `${PROFILE_BASE}evidence-excerpt/1`;

    it('accepts a valid body for a registered profile', async () => {
      const res = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'x', {
          body: {
            type: 'StructuredBody',
            profile,
            purpose: 'classifying',
            value: { kind: 'case', identifiers: ['PMID:12345'] },
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ body: { type: 'StructuredBody', profile } });
    });

    it('rejects a schema violation with a useful error', async () => {
      const res = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'x', {
          body: [
            { type: 'TextualBody', value: 'fine' },
            { type: 'StructuredBody', profile, value: { kind: 'rumour', bogus: 1 } },
          ],
        }),
      });
      expect(res.statusCode).toBe(422);
      const body = res.json<{ errors: { instancePath: string; message: string }[] }>();
      expect(body.errors.map((e) => e.instancePath)).toEqual(
        expect.arrayContaining(['/body/1/value/kind', '/body/1/value']),
      );
    });

    it('rejects an unregistered profile', async () => {
      const res = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'x', {
          body: {
            type: 'StructuredBody',
            profile: 'https://example.org/profiles/nope/1',
            value: {},
          },
        }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ errors: { instancePath: string }[] }>().errors[0]?.instancePath).toBe(
        '/body/0/profile',
      );
    });

    it('validates the items of a Choice body too', async () => {
      const res = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'x', {
          body: {
            type: 'Choice',
            items: [
              { type: 'TextualBody', value: 'plain' },
              { type: 'StructuredBody', profile: 'https://example.org/profiles/nope/1', value: {} },
            ],
          },
        }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ errors: { instancePath: string }[] }>().errors[0]?.instancePath).toBe(
        '/body/0/items/1/profile',
      );
    });

    it('rejects a context nested in a body or target, and an oversized body', async () => {
      const nested = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'x', {
          body: { type: 'TextualBody', value: 'x', '@context': 'https://evil.example/ctx.jsonld' },
        }),
      });
      expect(nested.statusCode).toBe(422);
      expect(nested.json<{ detail: string }>().detail).toContain('/body/@context');
      const huge = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'y'.repeat(100_001)),
      });
      expect(huge.statusCode).toBe(400);
    });

    it('validates a JSON TextualBody whose purpose maps to a profile', async () => {
      const res = await ctx.as(alice, {
        method: 'POST',
        url: '/annotations/',
        headers: LD_JSON,
        payload: annotationOn(PAGE, 'x', {
          body: {
            type: 'TextualBody',
            format: 'application/json',
            purpose: 'classifying',
            value: '{"kind": "nope"}',
          },
        }),
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('container', () => {
    const OTHER = 'https://example.org/articles/2?utm_source=mail';
    const ids: string[] = [];

    beforeAll(async () => {
      for (let i = 0; i < 25; i++) {
        const res = await ctx.as(bob, {
          method: 'POST',
          url: '/annotations/',
          headers: LD_JSON,
          payload: annotationOn(OTHER, `note ${i}`),
        });
        expect(res.statusCode).toBe(201);
        ids.push(res.json<{ id: string }>().id);
      }
    });

    it('describes itself as a basic container with an embedded first page of IRIs', async () => {
      const res = await ctx.as(bob, { method: 'GET', url: '/annotations/' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['link']).toContain(
        '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      );
      expect(res.headers['link']).toContain('rel="http://www.w3.org/ns/ldp#constrainedBy"');
      expect(res.headers['vary']).toBe('Accept, Prefer');
      expect(res.headers['etag']).toBeDefined();
      const body = res.json<{
        type: string[];
        total: number;
        first: { id: string; items: string[]; next?: string };
        last: string;
      }>();
      expect(body.type).toEqual(['BasicContainer', 'AnnotationCollection']);
      expect(body.total).toBeGreaterThanOrEqual(25);
      expect(body.first.items.length).toBe(20);
      expect(body.first.items[0]).toMatch(/^https:/);
      expect(body.first.id).toBe(`${PUBLIC_URL}/annotations/?page=0&iris=1`);
      expect(body.first.next).toBe(`${PUBLIC_URL}/annotations/?page=1&iris=1`);
      expect(body.last).toMatch(/page=\d+&iris=1$/);
    });

    it('honours Prefer for minimal containers and contained descriptions', async () => {
      const minimal = await ctx.as(bob, {
        method: 'GET',
        url: '/annotations/',
        headers: {
          prefer:
            'return=representation; include="http://www.w3.org/ns/ldp#PreferMinimalContainer"',
        },
      });
      expect(minimal.headers['preference-applied']).toBe('return=representation');
      expect(minimal.json<{ first: unknown }>().first).toBe(
        `${PUBLIC_URL}/annotations/?page=0&iris=1`,
      );

      const full = await ctx.as(bob, {
        method: 'GET',
        url: '/annotations/',
        headers: {
          prefer:
            'return=representation; include="http://www.w3.org/ns/ldp#PreferContainedDescriptions"',
        },
      });
      const first = full.json<{ first: { items: { type: string }[] } }>().first;
      expect(first.items[0]?.type).toBe('Annotation');
    });

    it('pages with iris, newest first, and 404s past the last page', async () => {
      const page0 = await ctx.as(bob, { method: 'GET', url: '/annotations/?page=0&iris=0' });
      const body0 = page0.json<{
        type: string;
        startIndex: number;
        items: { id: string; body: { value: string } }[];
        next?: string;
        prev?: string;
        partOf: string;
      }>();
      expect(body0.type).toBe('AnnotationPage');
      expect(body0.partOf).toBe(`${PUBLIC_URL}/annotations/`);
      expect(body0.startIndex).toBe(0);
      expect(body0.items[0]?.body.value).toBe('note 24');
      expect(body0.prev).toBeUndefined();
      expect(body0.next).toBe(`${PUBLIC_URL}/annotations/?page=1&iris=0`);

      const page1 = await ctx.as(bob, { method: 'GET', url: '/annotations/?page=1&iris=1' });
      const body1 = page1.json<{ startIndex: number; items: string[]; prev?: string }>();
      expect(body1.startIndex).toBe(20);
      expect(body1.items.length).toBeGreaterThanOrEqual(5);
      expect(body1.prev).toBe(`${PUBLIC_URL}/annotations/?page=0&iris=1`);

      const beyond = await ctx.as(bob, { method: 'GET', url: '/annotations/?page=99' });
      expect(beyond.statusCode).toBe(404);
    });

    it('filters by target through equivalent URIs', async () => {
      const res = await ctx.as(bob, {
        method: 'GET',
        url: `/annotations/?target=${encodeURIComponent('http://example.org/articles/2')}`,
      });
      const body = res.json<{ id: string; total: number; first: { id: string } }>();
      expect(body.total).toBe(25);
      expect(body.id).toContain('?target=');
      expect(body.first.id).toContain('&page=0');
      const none = await ctx.as(bob, {
        method: 'GET',
        url: `/annotations/?target=${encodeURIComponent('https://example.org/unknown')}`,
      });
      expect(none.json<{ total: number }>().total).toBe(0);
    });
  });
});
