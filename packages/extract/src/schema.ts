/**
 * The JSON Schema the model's answer must follow, derived from a profile's
 * schema. Constrained decoders (llama.cpp's grammars behind Ollama, vLLM's
 * guided decoding, hosted structured outputs) accept a subset of JSON
 * Schema, so the projection keeps structure, types, enums, required fields
 * and descriptions, and leaves length and pattern limits to the profile's
 * own validation afterwards. An ontology field (`ontology` keyword on an
 * array of `{id?, label}`) becomes an array of labels: the model never
 * supplies identifiers, the ontology lookup does (ADR 0031).
 */
import type { BodyProfile, JsonSchema, OntologyLookup } from '@curanno/model';

/** Where an ontology field is in a value: property names, and `*` for every array item. */
export type ValuePath = string[];

export interface OntologyField {
  path: ValuePath;
  ontology: OntologyLookup;
}

export interface OutputSchema {
  /** `{suggestions: [{quote, value}]}`, the shape the model returns. */
  schema: JsonSchema;
  /** The projected schema of one suggestion's value, for the prompt. */
  valueSchema: JsonSchema;
  /** The ontology fields of the profile, whose labels are resolved after the answer. */
  ontologyFields: OntologyField[];
}

/** Thrown for a profile whose schema cannot be turned into an output schema. */
export class UnsupportedProfileError extends Error {}

const KEPT = new Set([
  'type',
  'enum',
  'const',
  'title',
  'description',
  'required',
  'minItems',
  'maxItems',
]);

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function project(node: unknown, path: ValuePath, fields: OntologyField[]): Schema {
  if (!isSchema(node)) throw new UnsupportedProfileError(`not a schema at /${path.join('/')}`);
  for (const keyword of ['$ref', 'oneOf', 'anyOf', 'allOf', 'if', 'not']) {
    if (keyword in node) {
      throw new UnsupportedProfileError(`${keyword} is not supported (at /${path.join('/')})`);
    }
  }
  const out: Schema = {};
  for (const [key, value] of Object.entries(node)) if (KEPT.has(key)) out[key] = value;

  const ontology = node['ontology'];
  if (isSchema(ontology) && typeof ontology['name'] === 'string') {
    fields.push({ path, ontology: ontology as unknown as OntologyLookup });
    const labels: Schema = { type: 'array', items: { type: 'string' } };
    if (typeof node['title'] === 'string') labels['title'] = node['title'];
    if (typeof node['description'] === 'string') {
      labels['description'] =
        `${node['description']} Give each term as a label; identifiers are looked up later.`;
    }
    return labels;
  }

  if (isSchema(node['properties'])) {
    const properties: Schema = {};
    for (const [name, child] of Object.entries(node['properties'])) {
      properties[name] = project(child, [...path, name], fields);
    }
    out['properties'] = properties;
    out['additionalProperties'] = false;
  }
  if ('items' in node) out['items'] = project(node['items'], [...path, '*'], fields);
  return out;
}

export function outputSchema(profile: BodyProfile): OutputSchema {
  const ontologyFields: OntologyField[] = [];
  const value = project(profile.schema, [], ontologyFields);
  const schema: JsonSchema = {
    type: 'object',
    required: ['suggestions'],
    additionalProperties: false,
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['quote', 'value'],
          additionalProperties: false,
          properties: {
            quote: {
              type: 'string',
              description:
                'A passage copied character for character from the document that supports the value.',
            },
            value,
          },
        },
      },
    },
  };
  return { schema, valueSchema: value, ontologyFields };
}
