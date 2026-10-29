// Binding B: load the OpenAPI document ourselves, dereference it, and
// register each operation with Fastify's native route schema. About 60
// lines of our own glue, no plugin dependency.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { handlers, runScenarios } from './scenarios.ts';

type Json = Record<string, unknown>;

function deref(node: unknown, root: Json): unknown {
  if (Array.isArray(node)) return node.map((n) => deref(n, root));
  if (node && typeof node === 'object') {
    const obj = node as Json;
    if (typeof obj['$ref'] === 'string') {
      const target = obj['$ref']
        .replace(/^#\//, '')
        .split('/')
        .reduce<unknown>((acc, key) => (acc as Json)[key], root);
      return deref(target, root);
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deref(v, root)]));
  }
  return node;
}

function routeSchema(op: Json): Json {
  const schema: Json = {};
  const params = (op['parameters'] as Json[] | undefined) ?? [];
  for (const where of ['path', 'query', 'header'] as const) {
    const ps = params.filter((p) => p['in'] === where);
    if (ps.length === 0) continue;
    schema[where === 'path' ? 'params' : where === 'query' ? 'querystring' : 'headers'] = {
      type: 'object',
      required: ps.filter((p) => p['required']).map((p) => p['name']),
      properties: Object.fromEntries(ps.map((p) => [p['name'] as string, p['schema']])),
    };
  }
  const body = (op['requestBody'] as Json | undefined)?.['content'] as Json | undefined;
  const json = body?.['application/json'] as Json | undefined;
  if (json?.['schema']) schema['body'] = json['schema'];
  const responses: Json = {};
  for (const [code, res] of Object.entries((op['responses'] as Json) ?? {})) {
    const c = ((res as Json)['content'] as Json | undefined)?.['application/json'] as
      Json | undefined;
    if (c?.['schema']) responses[code] = c['schema'];
  }
  if (Object.keys(responses).length) schema['response'] = responses;
  return schema;
}

const spec = parse(readFileSync(new URL('./openapi.yaml', import.meta.url), 'utf8')) as Json;
const derefd = deref(spec, spec) as Json;
const app = Fastify({ logger: false });

const impl: Record<string, (req: FastifyRequest, reply: FastifyReply) => unknown> = {
  getItem(req, reply) {
    const r = handlers.getItem((req.params as { id: string }).id);
    reply.code(r.status);
    return r.body;
  },
  createItem(req, reply) {
    const r = handlers.createItem(req.body as { name: string; tags?: string[] });
    reply.code(r.status);
    return r.body;
  },
};

for (const [path, item] of Object.entries(derefd['paths'] as Json)) {
  for (const [method, op] of Object.entries(item as Json)) {
    const operation = op as Json;
    const handler = impl[operation['operationId'] as string];
    if (!handler) throw new Error(`no handler for ${String(operation['operationId'])}`);
    app.route({
      method: method.toUpperCase(),
      url: path.replace(/\{(\w+)\}/g, ':$1'),
      schema: routeSchema(operation),
      handler,
    });
  }
}
await runScenarios('manual binding', app);
