/**
 * The contract suite: every operation in apps/api/openapi.yaml is exercised
 * against the live server and a real Postgres, and each response must be a
 * status the document declares, in a media type it declares, with a body
 * that validates against the declared schema (success criterion 2). The
 * server also validates its own responses; this suite checks from the
 * outside, with the document as the only source of truth, and fails when an
 * operation has no scenario so that the document cannot grow unnoticed.
 * `contract.test.ts` runs it on a scratch database and
 * `db/backup-restore.test.ts` on a restored one; it needs an empty database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { parse } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROFILE_BASE } from '@curanno/model';
import { createStrictAjv } from './ajv.js';
import { PUBLIC_PRINCIPAL_ID } from './db/index.js';
import {
  alice,
  annotationOn,
  bob,
  createGroup,
  root,
  type TestContext,
  type TestUser,
} from './test/harness.js';

type Json = Record<string, unknown>;

interface Operation {
  operationId: string;
  method: string;
  path: string;
  responses: Record<string, { content?: Record<string, { schema?: Json }> }>;
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch']);

const DOCUMENT_ID = 'https://curanno.example/openapi.yaml';
const SCHEMA_PREFIX = '#/components/schemas/';

/** Follow `$ref` to responses, parameters and request bodies; point schema refs at the Ajv copy of the components. */
function resolve(node: unknown, root: Json): unknown {
  if (Array.isArray(node)) return node.map((n) => resolve(n, root));
  if (node && typeof node === 'object') {
    const obj = node as Json;
    const ref = obj['$ref'];
    if (typeof ref === 'string') {
      if (ref.startsWith(SCHEMA_PREFIX))
        return { $ref: `${DOCUMENT_ID}#/$defs/${ref.slice(SCHEMA_PREFIX.length)}` };
      const target = ref
        .replace(/^#\//, '')
        .split('/')
        .reduce<unknown>((acc, key) => (acc as Json)[key], root);
      return resolve(target, root);
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolve(v, root)]));
  }
  return node;
}

function loadOperations(): { operations: Operation[]; document: Json } {
  const document = parse(
    readFileSync(fileURLToPath(new URL('../openapi.yaml', import.meta.url)), 'utf8'),
  ) as Json;
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(document['paths'] as Record<string, Json>)) {
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.has(method)) continue;
      const operation = resolve(op, document) as Json;
      operations.push({
        operationId: operation['operationId'] as string,
        method: method.toUpperCase(),
        path,
        responses: operation['responses'] as Operation['responses'],
      });
    }
  }
  return { operations, document };
}

const { operations, document } = loadOperations();
const ajv = createStrictAjv();
ajv.addSchema({
  $id: DOCUMENT_ID,
  $defs: resolve((document['components'] as Json)['schemas'], document),
});

interface Scenario {
  name: string;
  as: TestUser | null;
  request: () => InjectOptions;
  /** The status the scenario expects; the response is validated against the document either way. */
  status: number;
  then?: (response: LightMyRequestResponse) => unknown;
}

const LD_JSON = { 'content-type': 'application/ld+json' };
const PAGE = 'https://example.org/contract';
const NIL = '00000000-0000-0000-0000-000000000000';

/** Define the suite under `name`, against the context `open` creates (closed afterwards). */
export function describeContract(name: string, open: () => Promise<TestContext>): void {
  describe(name, () => {
    let ctx: TestContext;
    const state: Record<string, string> = {};
    const exercised = new Set<string>();

    beforeAll(async () => {
      ctx = await open();
      const me = await ctx.as(alice, { method: 'GET', url: '/x/me' });
      state['aliceId'] = me.json<{ id: string }>().id;
      const bobMe = await ctx.as(bob, { method: 'GET', url: '/x/me' });
      state['bobId'] = bobMe.json<{ id: string }>().id;
      const rootMe = await ctx.as(root, { method: 'GET', url: '/x/me' });
      state['rootId'] = rootMe.json<{ id: string }>().id;
      // Bootstrapped directly, as an operator would for the first administrator (ADR 0026).
      await ctx.db
        .updateTable('users')
        .set({ is_admin: true })
        .where('subject', '=', root.sub)
        .execute();
      // So that searchPrincipals has a group to find alongside users.
      await createGroup(ctx, 'Search group', [alice]);
      // Two people waiting for approval, as the embedded sign-up would leave them.
      for (const [key, name] of [
        ['first', 'Pending Pat'],
        ['second', 'Pending Sam'],
      ] as const) {
        const principal = await ctx.db
          .insertInto('principals')
          .values({ kind: 'user' })
          .returning('id')
          .executeTakeFirstOrThrow();
        await ctx.db
          .insertInto('users')
          .values({
            principal_id: principal.id,
            issuer: 'https://applicants.example',
            subject: principal.id,
            display_name: name,
            email: `${key}@applicants.example`,
            status: 'pending',
          })
          .execute();
        const application = await ctx.db
          .insertInto('applications')
          .values({ principal_id: principal.id, note: 'I would like to help' })
          .returning('id')
          .executeTakeFirstOrThrow();
        state[`${key}Applicant`] = principal.id;
        state[`${key}Application`] = application.id;
      }
    });
    afterAll(() => ctx.close());

    function validateAgainstDocument(operation: Operation, res: LightMyRequestResponse): void {
      const declared = operation.responses[String(res.statusCode)];
      expect(
        declared,
        `${operation.operationId} answered undeclared status ${res.statusCode}`,
      ).toBeDefined();
      if (res.statusCode === 204) {
        expect(res.body).toBe('');
        return;
      }
      const mediaType = (res.headers['content-type'] as string).split(';')[0]?.trim() as string;
      const content = declared?.content?.[mediaType];
      expect(
        content,
        `${operation.operationId}: ${mediaType} is not declared for ${res.statusCode}`,
      ).toBeDefined();
      if (mediaType === 'text/event-stream') return;
      const schema = content?.schema;
      if (!schema) return;
      const validate = ajv.compile(schema);
      const ok = validate(res.json());
      expect(
        ok,
        `${operation.operationId} ${res.statusCode}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    }

    function run(operationId: string, scenarios: Scenario[]): void {
      const operation = operations.find((o) => o.operationId === operationId);
      describe(operationId, () => {
        it('is in the document', () => {
          expect(operation).toBeDefined();
        });
        for (const scenario of scenarios) {
          it(scenario.name, async () => {
            if (!operation) return;
            exercised.add(operationId);
            const res = await ctx.as(scenario.as, scenario.request());
            expect(res.statusCode, res.body).toBe(scenario.status);
            validateAgainstDocument(operation, res);
            await scenario.then?.(res);
          });
        }
      });
    }

    const idOf = (res: LightMyRequestResponse): string =>
      res.json<{ id: string }>().id.split('/').pop() as string;

    run('getExtensionContext', [
      {
        name: 'serves the context',
        as: null,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/context.jsonld' }),
        then: (res) => {
          expect(res.headers['content-type']).toMatch(/^application\/ld\+json/);
          const context = res.json<{ '@context': Record<string, unknown> }>()['@context'];
          expect(context['StructuredBody']).toBe('https://curanno.example/ns/anno#StructuredBody');
          expect(context['permissions']).toMatchObject({ '@container': '@set' });
        },
      },
    ]);
    run('registerDocument', [
      {
        name: 'creates a document',
        as: alice,
        status: 201,
        request: () => ({
          method: 'POST',
          url: '/x/documents',
          payload: {
            uri: PAGE,
            title: 'Contract',
            links: [{ uri: '/canonical/contract', relation: 'canonical' }],
          },
        }),
        then: (res) => (state['documentId'] = res.json<{ id: string }>().id),
      },
      {
        name: 'rejects a malformed body',
        as: alice,
        status: 400,
        request: () => ({ method: 'POST', url: '/x/documents', payload: { links: 'no' } }),
      },
      {
        name: 'needs a token',
        as: null,
        status: 401,
        request: () => ({ method: 'POST', url: '/x/documents', payload: { uri: PAGE, links: [] } }),
      },
    ]);
    run('lookupDocument', [
      {
        name: 'finds by equivalent URI',
        as: alice,
        status: 200,
        request: () => ({
          method: 'GET',
          url: `/x/documents?uri=${encodeURIComponent('https://example.org/canonical/contract')}`,
        }),
      },
      {
        name: '404 for unknown URIs',
        as: alice,
        status: 404,
        request: () => ({
          method: 'GET',
          url: `/x/documents?uri=${encodeURIComponent('https://example.org/none')}`,
        }),
      },
      {
        name: '400 without uri',
        as: alice,
        status: 400,
        request: () => ({ method: 'GET', url: '/x/documents' }),
      },
      {
        name: 'needs a token',
        as: null,
        status: 401,
        request: () => ({
          method: 'GET',
          url: `/x/documents?uri=${encodeURIComponent('https://example.org/canonical/contract')}`,
        }),
      },
    ]);
    run('getDocument', [
      {
        name: 'by id',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: `/x/documents/${state['documentId']}` }),
      },
      {
        name: '404',
        as: alice,
        status: 404,
        request: () => ({ method: 'GET', url: `/x/documents/${NIL}` }),
      },
      {
        name: 'needs a token',
        as: null,
        status: 401,
        request: () => ({ method: 'GET', url: `/x/documents/${state['documentId']}` }),
      },
    ]);

    run('createAnnotation', [
      {
        name: 'creates',
        as: alice,
        status: 201,
        request: () => ({
          method: 'POST',
          url: '/annotations/',
          headers: LD_JSON,
          payload: annotationOn(PAGE, 'contract body'),
        }),
        then: (res) => {
          state['annotationId'] = idOf(res);
          state['etag'] = res.headers['etag'] as string;
        },
      },
      {
        name: 'creates as JSON',
        as: bob,
        status: 201,
        request: () => ({
          method: 'POST',
          url: '/annotations/',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          payload: annotationOn(PAGE, 'by bob'),
        }),
        then: (res) => (state['bobsId'] = idOf(res)),
      },
      {
        name: '400 on schema violation',
        as: alice,
        status: 400,
        request: () => ({
          method: 'POST',
          url: '/annotations/',
          headers: LD_JSON,
          payload: { type: 'Annotation' },
        }),
      },
      {
        name: '401 anonymous',
        as: null,
        status: 401,
        request: () => ({
          method: 'POST',
          url: '/annotations/',
          headers: LD_JSON,
          payload: annotationOn(PAGE),
        }),
      },
      {
        name: '422 on profile violation',
        as: alice,
        status: 422,
        request: () => ({
          method: 'POST',
          url: '/annotations/',
          headers: LD_JSON,
          payload: annotationOn(PAGE, 'x', {
            body: {
              type: 'StructuredBody',
              profile: `${PROFILE_BASE}evidence-excerpt/1`,
              value: {},
            },
          }),
        }),
      },
    ]);
    run('getAnnotation', [
      {
        name: 'as JSON-LD',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: `/annotations/${state['annotationId']}` }),
      },
      {
        name: 'as JSON',
        as: alice,
        status: 200,
        request: () => ({
          method: 'GET',
          url: `/annotations/${state['annotationId']}`,
          headers: { accept: 'application/json' },
        }),
      },
      {
        name: '404 when not readable',
        as: bob,
        status: 404,
        request: () => ({ method: 'GET', url: `/annotations/${state['annotationId']}` }),
      },
    ]);
    run('listContainer', [
      {
        name: 'collection',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: '/annotations/' }),
      },
      {
        name: 'page with descriptions',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: '/annotations/?page=0&iris=0' }),
      },
      {
        name: 'minimal container',
        as: null,
        status: 200,
        request: () => ({
          method: 'GET',
          url: '/annotations/',
          headers: {
            prefer:
              'return=representation; include="http://www.w3.org/ns/ldp#PreferMinimalContainer"',
          },
        }),
      },
      {
        name: '404 past the end',
        as: alice,
        status: 404,
        request: () => ({ method: 'GET', url: '/annotations/?page=5' }),
      },
      {
        name: '400 on a bad page',
        as: alice,
        status: 400,
        request: () => ({ method: 'GET', url: '/annotations/?page=-1' }),
      },
    ]);
    run('grantPermission', [
      {
        name: 'grants read to public',
        as: alice,
        status: 201,
        request: () => ({
          method: 'POST',
          url: `/x/annotations/${state['annotationId']}/acl`,
          payload: { principal: PUBLIC_PRINCIPAL_ID, permission: 'read' },
        }),
      },
      {
        name: '400 for an unknown principal',
        as: alice,
        status: 400,
        request: () => ({
          method: 'POST',
          url: `/x/annotations/${state['annotationId']}/acl`,
          payload: { principal: NIL, permission: 'read' },
        }),
      },
    ]);
    run('updateAnnotation', [
      {
        name: '428 without If-Match',
        as: alice,
        status: 428,
        request: () => ({
          method: 'PUT',
          url: `/annotations/${state['annotationId']}`,
          headers: LD_JSON,
          payload: annotationOn(PAGE, 'v2'),
        }),
      },
      {
        name: '412 on stale If-Match',
        as: alice,
        status: 412,
        request: () => ({
          method: 'PUT',
          url: `/annotations/${state['annotationId']}`,
          headers: { ...LD_JSON, 'if-match': '"0"' },
          payload: annotationOn(PAGE, 'v2'),
        }),
      },
      {
        name: '403 without permission',
        as: bob,
        status: 403,
        request: () => ({
          method: 'PUT',
          url: `/annotations/${state['annotationId']}`,
          headers: { ...LD_JSON, 'if-match': '*' },
          payload: annotationOn(PAGE, 'v2'),
        }),
      },
      {
        name: 'replaces',
        as: alice,
        status: 200,
        request: () => ({
          method: 'PUT',
          url: `/annotations/${state['annotationId']}`,
          headers: { ...LD_JSON, 'if-match': state['etag'] as string },
          payload: annotationOn(PAGE, 'v2'),
        }),
        then: (res) => (state['etag'] = res.headers['etag'] as string),
      },
      {
        name: '422 on selector change',
        as: alice,
        status: 422,
        request: () => ({
          method: 'PUT',
          url: `/annotations/${state['annotationId']}`,
          headers: { ...LD_JSON, 'if-match': state['etag'] as string },
          payload: {
            ...annotationOn(PAGE, 'v3'),
            target: { source: PAGE, selector: { type: 'TextQuoteSelector', exact: 'different' } },
          },
        }),
      },
    ]);

    run('getAcl', [
      {
        name: 'lists',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: `/x/annotations/${state['annotationId']}/acl` }),
      },
      {
        name: '403 without share',
        as: bob,
        status: 403,
        request: () => ({ method: 'GET', url: `/x/annotations/${state['annotationId']}/acl` }),
      },
      {
        name: '404',
        as: alice,
        status: 404,
        request: () => ({ method: 'GET', url: `/x/annotations/${NIL}/acl` }),
      },
    ]);
    run('replaceAcl', [
      {
        name: 'replaces',
        as: alice,
        status: 200,
        request: () => ({
          method: 'PUT',
          url: `/x/annotations/${state['annotationId']}/acl`,
          payload: [{ principal: state['bobId'], permission: 'read' }],
        }),
      },
      {
        name: '400 on a bad permission',
        as: alice,
        status: 400,
        request: () => ({
          method: 'PUT',
          url: `/x/annotations/${state['annotationId']}/acl`,
          payload: [{ principal: state['bobId'], permission: 'own' }],
        }),
      },
    ]);
    run('revokePermission', [
      {
        name: 'revokes',
        as: alice,
        status: 204,
        request: () => ({
          method: 'DELETE',
          url: `/x/annotations/${state['annotationId']}/acl/${state['bobId']}/read`,
        }),
      },
      {
        name: "403 for the creator's own",
        as: alice,
        status: 403,
        request: () => ({
          method: 'DELETE',
          url: `/x/annotations/${state['annotationId']}/acl/${state['aliceId']}/read`,
        }),
      },
    ]);

    run('searchAnnotations', [
      {
        name: 'by uri and text',
        as: alice,
        status: 200,
        request: () => ({
          method: 'GET',
          url: `/x/search?uri=${encodeURIComponent(PAGE)}&text=v2&limit=10`,
        }),
        then: (res) => expect(res.json<{ total: number }>().total).toBe(1),
      },
      {
        name: 'anonymous',
        as: null,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/search' }),
      },
      {
        name: '400 on a bad filter',
        as: alice,
        status: 400,
        request: () => ({ method: 'GET', url: '/x/search?state=lost' }),
      },
    ]);

    run('deleteAnnotation', [
      {
        name: '428 without If-Match',
        as: alice,
        status: 428,
        request: () => ({ method: 'DELETE', url: `/annotations/${state['annotationId']}` }),
      },
      {
        name: 'deletes',
        as: alice,
        status: 204,
        request: () => ({
          method: 'DELETE',
          url: `/annotations/${state['annotationId']}`,
          headers: { 'if-match': state['etag'] as string },
        }),
      },
      {
        name: '410 afterwards',
        as: alice,
        status: 410,
        request: () => ({
          method: 'DELETE',
          url: `/annotations/${state['annotationId']}`,
          headers: { 'if-match': '*' },
        }),
      },
    ]);

    run('listProfiles', [
      {
        name: 'lists',
        as: null,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/profiles' }),
      },
    ]);
    run('getProfile', [
      {
        name: 'built-in',
        as: null,
        status: 200,
        request: () => ({
          method: 'GET',
          url: `/x/profiles/${encodeURIComponent(`${PROFILE_BASE}evidence-excerpt/1`)}`,
        }),
      },
      {
        name: '404',
        as: null,
        status: 404,
        request: () => ({
          method: 'GET',
          url: `/x/profiles/${encodeURIComponent('https://example.org/none')}`,
        }),
      },
    ]);
    const customProfile = encodeURIComponent('https://example.org/profiles/note/1');
    run('putProfile', [
      {
        name: 'registers',
        as: root,
        status: 201,
        request: () => ({
          method: 'PUT',
          url: `/x/profiles/${customProfile}`,
          payload: {
            title: 'Note',
            defaultPurpose: 'commenting',
            schema: {
              type: 'object',
              required: ['text'],
              properties: { text: { type: 'string' } },
            },
          },
        }),
      },
      {
        name: 'updates',
        as: root,
        status: 200,
        request: () => ({
          method: 'PUT',
          url: `/x/profiles/${customProfile}`,
          payload: { title: 'Note v1', schema: { type: 'object' } },
        }),
      },
      {
        name: '403 for non-administrators',
        as: alice,
        status: 403,
        request: () => ({
          method: 'PUT',
          url: `/x/profiles/${customProfile}`,
          payload: { title: 'x', schema: {} },
        }),
      },
      {
        name: '409 for built-ins',
        as: root,
        status: 409,
        request: () => ({
          method: 'PUT',
          url: `/x/profiles/${encodeURIComponent(`${PROFILE_BASE}evidence-excerpt/1`)}`,
          payload: { title: 'x', schema: {} },
        }),
      },
      {
        name: '400 for a schema that does not compile',
        as: root,
        status: 400,
        request: () => ({
          method: 'PUT',
          url: `/x/profiles/${customProfile}`,
          payload: { title: 'x', schema: { type: 'nonsense' } },
        }),
      },
    ]);
    run('deleteProfile', [
      {
        name: 'removes',
        as: root,
        status: 204,
        request: () => ({ method: 'DELETE', url: `/x/profiles/${customProfile}` }),
      },
      {
        name: '404 afterwards',
        as: root,
        status: 404,
        request: () => ({ method: 'DELETE', url: `/x/profiles/${customProfile}` }),
      },
      {
        name: '409 for built-ins',
        as: root,
        status: 409,
        request: () => ({
          method: 'DELETE',
          url: `/x/profiles/${encodeURIComponent(`${PROFILE_BASE}evidence-excerpt/1`)}`,
        }),
      },
    ]);

    run('getCurrentUser', [
      { name: 'me', as: alice, status: 200, request: () => ({ method: 'GET', url: '/x/me' }) },
      { name: '401', as: null, status: 401, request: () => ({ method: 'GET', url: '/x/me' }) },
    ]);
    run('listUsers', [
      {
        name: 'administrators list',
        as: root,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/users?q=ali&limit=5' }),
        then: (res) => expect(res.json<{ total: number }>().total).toBe(1),
      },
      {
        name: '403 otherwise',
        as: alice,
        status: 403,
        request: () => ({ method: 'GET', url: '/x/users' }),
      },
    ]);
    run('getUser', [
      {
        name: 'by id',
        as: bob,
        status: 200,
        request: () => ({ method: 'GET', url: `/x/users/${state['aliceId']}` }),
      },
      {
        name: '404',
        as: bob,
        status: 404,
        request: () => ({ method: 'GET', url: `/x/users/${NIL}` }),
      },
    ]);
    run('updateUser', [
      {
        name: 'renames',
        as: root,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/users/${state['bobId']}`,
          payload: { displayName: 'Robert' },
        }),
        then: (res) => expect(res.json<{ displayName: string }>().displayName).toBe('Robert'),
      },
      {
        name: '403',
        as: alice,
        status: 403,
        request: () => ({
          method: 'PATCH',
          url: `/x/users/${state['bobId']}`,
          payload: { isAdmin: true },
        }),
      },
      {
        name: 'grants administration',
        as: root,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/users/${state['bobId']}`,
          payload: { isAdmin: true },
        }),
        then: (res) => expect(res.json<{ isAdmin: boolean }>().isAdmin).toBe(true),
      },
      {
        name: 'withdraws administration',
        as: root,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/users/${state['bobId']}`,
          payload: { isAdmin: false },
        }),
        then: (res) => expect(res.json<{ isAdmin: boolean }>().isAdmin).toBe(false),
      },
    ]);
    run('updateUser', [
      {
        name: 'disables and re-enables',
        as: root,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/users/${state['bobId']}`,
          payload: { status: 'disabled' },
        }),
        then: (res) => expect(res.json<{ status: string }>().status).toBe('disabled'),
      },
      {
        name: 'a disabled user is refused as anonymous on writes',
        as: bob,
        status: 403,
        request: () => ({ method: 'POST', url: '/x/groups', payload: { name: 'Nope' } }),
      },
      {
        name: 'a disabled user is still told their status',
        as: bob,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/me' }),
        then: (res) => expect(res.json<{ status: string }>().status).toBe('disabled'),
      },
      {
        name: 're-enables',
        as: root,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/users/${state['bobId']}`,
          payload: { status: 'active' },
        }),
      },
      {
        name: 'administrators cannot disable themselves',
        as: root,
        status: 409,
        request: () => ({
          method: 'PATCH',
          url: `/x/users/${state['rootId']}`,
          payload: { status: 'disabled' },
        }),
      },
    ]);
    run('listApplications', [
      {
        name: 'pending ones',
        as: root,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/applications?decision=pending' }),
        then: (res) => expect(res.json<{ total: number }>().total).toBe(2),
      },
      {
        name: '403 for others',
        as: alice,
        status: 403,
        request: () => ({ method: 'GET', url: '/x/applications' }),
      },
      {
        name: '401',
        as: null,
        status: 401,
        request: () => ({ method: 'GET', url: '/x/applications' }),
      },
    ]);
    run('getApplication', [
      {
        name: 'by id',
        as: root,
        status: 200,
        request: () => ({ method: 'GET', url: `/x/applications/${state['firstApplication']}` }),
        then: (res) =>
          expect(res.json<{ decision: string; displayName: string }>()).toMatchObject({
            decision: 'pending',
            displayName: 'Pending Pat',
          }),
      },
      {
        name: '404',
        as: root,
        status: 404,
        request: () => ({ method: 'GET', url: `/x/applications/${NIL}` }),
      },
      {
        name: '403 for others',
        as: alice,
        status: 403,
        request: () => ({ method: 'GET', url: `/x/applications/${state['firstApplication']}` }),
      },
    ]);
    run('decideApplication', [
      {
        name: '403 for others',
        as: alice,
        status: 403,
        request: () => ({
          method: 'PATCH',
          url: `/x/applications/${state['firstApplication']}`,
          payload: { decision: 'approved' },
        }),
      },
      {
        name: 'approves, making the applicant active',
        as: root,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/applications/${state['firstApplication']}`,
          payload: { decision: 'approved', note: 'Welcome' },
        }),
        then: async (res) => {
          expect(res.json<{ decision: string; decisionNote: string }>()).toMatchObject({
            decision: 'approved',
            decisionNote: 'Welcome',
          });
          const user = await ctx.db
            .selectFrom('users')
            .select('status')
            .where('principal_id', '=', state['firstApplicant'] as string)
            .executeTakeFirstOrThrow();
          expect(user.status).toBe('active');
        },
      },
      {
        name: '409 when decided twice',
        as: root,
        status: 409,
        request: () => ({
          method: 'PATCH',
          url: `/x/applications/${state['firstApplication']}`,
          payload: { decision: 'rejected' },
        }),
      },
      {
        name: 'rejects',
        as: root,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/applications/${state['secondApplication']}`,
          payload: { decision: 'rejected' },
        }),
        then: async () => {
          const user = await ctx.db
            .selectFrom('users')
            .select('status')
            .where('principal_id', '=', state['secondApplicant'] as string)
            .executeTakeFirstOrThrow();
          expect(user.status).toBe('rejected');
        },
      },
      {
        name: '400 for an unknown decision',
        as: root,
        status: 400,
        request: () => ({
          method: 'PATCH',
          url: `/x/applications/${state['secondApplication']}`,
          payload: { decision: 'maybe' },
        }),
      },
      {
        name: '404',
        as: root,
        status: 404,
        request: () => ({
          method: 'PATCH',
          url: `/x/applications/${NIL}`,
          payload: { decision: 'approved' },
        }),
      },
    ]);
    run('searchPrincipals', [
      {
        name: 'finds users, groups and pseudo-principals',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/principals?q=r' }),
        then: (res) =>
          expect(res.json<{ kind: string }[]>().map((p) => p.kind)).toEqual(
            expect.arrayContaining(['group', 'user']),
          ),
      },
    ]);

    run('createGroup', [
      {
        name: 'creates',
        as: alice,
        status: 201,
        request: () => ({
          method: 'POST',
          url: '/x/groups',
          payload: { name: 'Contract group', description: 'd' },
        }),
        then: (res) => (state['groupId'] = res.json<{ id: string }>().id),
      },
      {
        name: '409 on a duplicate name',
        as: bob,
        status: 409,
        request: () => ({ method: 'POST', url: '/x/groups', payload: { name: 'contract GROUP' } }),
      },
      {
        name: '400 on an empty name',
        as: bob,
        status: 400,
        request: () => ({ method: 'POST', url: '/x/groups', payload: { name: '' } }),
      },
    ]);
    run('listGroups', [
      {
        name: 'mine',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/groups' }),
        then: (res) =>
          expect(
            res.json<{ items: { role: string }[] }>().items.some((g) => g.role === 'admin'),
          ).toBe(true),
      },
      {
        name: 'none for outsiders',
        as: bob,
        status: 200,
        request: () => ({ method: 'GET', url: '/x/groups?q=contract' }),
        then: (res) => expect(res.json<{ total: number }>().total).toBe(0),
      },
    ]);
    run('getGroup', [
      {
        name: 'as a member',
        as: alice,
        status: 200,
        request: () => ({ method: 'GET', url: `/x/groups/${state['groupId']}` }),
      },
      {
        name: '404 for outsiders',
        as: bob,
        status: 404,
        request: () => ({ method: 'GET', url: `/x/groups/${state['groupId']}` }),
      },
    ]);
    run('setMember', [
      {
        name: 'adds a member with no body',
        as: alice,
        status: 204,
        request: () => ({
          method: 'PUT',
          url: `/x/groups/${state['groupId']}/members/${state['bobId']}`,
        }),
      },
      {
        name: '403 for members who are not administrators',
        as: bob,
        status: 403,
        request: () => ({
          method: 'PUT',
          url: `/x/groups/${state['groupId']}/members/${state['aliceId']}`,
          payload: { role: 'member' },
        }),
      },
      {
        name: '404 for unknown users',
        as: alice,
        status: 404,
        request: () => ({
          method: 'PUT',
          url: `/x/groups/${state['groupId']}/members/${NIL}`,
          payload: { role: 'member' },
        }),
      },
    ]);
    run('listMembers', [
      {
        name: 'lists',
        as: bob,
        status: 200,
        request: () => ({ method: 'GET', url: `/x/groups/${state['groupId']}/members` }),
        then: (res) => expect(res.json<unknown[]>()).toHaveLength(2),
      },
      {
        name: 'administrators see any group',
        as: root,
        status: 200,
        request: () => ({ method: 'GET', url: `/x/groups/${state['groupId']}/members` }),
      },
    ]);
    run('updateGroup', [
      {
        name: 'renames',
        as: alice,
        status: 200,
        request: () => ({
          method: 'PATCH',
          url: `/x/groups/${state['groupId']}`,
          payload: { name: 'Renamed group' },
        }),
      },
      {
        name: '403 for plain members',
        as: bob,
        status: 403,
        request: () => ({
          method: 'PATCH',
          url: `/x/groups/${state['groupId']}`,
          payload: { name: 'Nope' },
        }),
      },
    ]);
    run('removeMember', [
      {
        name: '409 for the last administrator',
        as: alice,
        status: 409,
        request: () => ({
          method: 'DELETE',
          url: `/x/groups/${state['groupId']}/members/${state['aliceId']}`,
        }),
      },
      {
        name: 'a member leaves',
        as: bob,
        status: 204,
        request: () => ({
          method: 'DELETE',
          url: `/x/groups/${state['groupId']}/members/${state['bobId']}`,
        }),
      },
      {
        name: '404 when not a member',
        as: alice,
        status: 404,
        request: () => ({
          method: 'DELETE',
          url: `/x/groups/${state['groupId']}/members/${state['bobId']}`,
        }),
      },
    ]);
    run('deleteGroup', [
      {
        name: '404 for outsiders',
        as: bob,
        status: 404,
        request: () => ({ method: 'DELETE', url: `/x/groups/${state['groupId']}` }),
      },
      {
        name: 'deletes',
        as: alice,
        status: 204,
        request: () => ({ method: 'DELETE', url: `/x/groups/${state['groupId']}` }),
      },
    ]);

    run('streamEvents', [
      {
        name: '400 on a bad document id',
        as: alice,
        status: 400,
        request: () => ({ method: 'GET', url: '/x/events?document=nope' }),
      },
    ]);

    it('exercised every operation in the document', () => {
      const missing = operations.map((o) => o.operationId).filter((id) => !exercised.has(id));
      expect(missing).toEqual([]);
    });
  });
}
