/**
 * Guards the OpenAPI document: its annotation component schemas must equal
 * the model package's JSON Schemas, every operation needs a unique
 * operationId (fastify-openapi-glue maps handlers by it, ADR 0011), and
 * every path is either W3C protocol or under the extension prefix.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { annotationSchemas } from '@curanno/model';

interface OpenApi {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);

const document = parse(
  readFileSync(fileURLToPath(new URL('../openapi.yaml', import.meta.url)), 'utf8'),
) as OpenApi;

/** The model schema as it must appear among the OpenAPI components. */
function asComponent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asComponent);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === '$schema' || key === '$id') continue;
      out[key] =
        key === '$ref' && typeof inner === 'string'
          ? `#/components/schemas/${inner}`
          : asComponent(inner);
    }
    return out;
  }
  return value;
}

describe('openapi.yaml', () => {
  for (const [name, schema] of Object.entries(annotationSchemas)) {
    it(`component ${name} equals the model schema`, () => {
      expect(document.components.schemas[name]).toEqual(asComponent(schema));
    });
  }

  it('gives every operation a unique operationId', () => {
    const ids: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!METHODS.has(method)) continue;
        expect(operation.operationId, `${method.toUpperCase()} ${path}`).toMatch(
          /^[a-z][A-Za-z]+$/,
        );
        ids.push(operation.operationId as string);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps extensions under /x/', () => {
    for (const path of Object.keys(document.paths)) {
      expect(path).toMatch(/^(\/annotations\/|\/x\/)/);
    }
  });
});
