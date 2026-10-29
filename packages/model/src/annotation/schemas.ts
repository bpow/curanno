/**
 * JSON Schemas (draft 2020-12) for the annotation types in types.ts. The
 * server loads them into its Ajv instance to validate requests, the sidebar
 * can use them for client-side checks, and the OpenAPI document's component
 * schemas must stay equal to them (a test in apps/api checks this).
 *
 * Schemas reference each other by relative `$ref` resolved against
 * SCHEMA_BASE, so loading all of them into one Ajv instance is enough.
 * `additionalProperties` is left open on JSON-LD resources so that extension
 * properties round-trip (ADR 0011).
 */
import { ANCHORING_STATES, MOTIVATIONS, PERMISSIONS } from './types.js';

export const SCHEMA_BASE = 'https://scale.example/schemas/annotation/';

export type JsonSchema = Record<string, unknown>;

const ref = (name: string): JsonSchema => ({ $ref: name });
const oneOrMany = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: 'array', items: schema }],
});
const iri: JsonSchema = { type: 'string', format: 'iri' };
const string: JsonSchema = { type: 'string' };
const dateTime: JsonSchema = { type: 'string', format: 'date-time' };
const refinedBy = { refinedBy: oneOrMany(ref('Selector')) };

function schema(name: string, body: JsonSchema): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_BASE + name,
    ...body,
  };
}

export const Motivation = schema('Motivation', {
  description: 'A standard motivation or an IRI naming an extension motivation.',
  anyOf: [{ type: 'string', enum: [...MOTIVATIONS] }, iri],
});

export const Agent = schema('Agent', {
  type: 'object',
  properties: {
    id: iri,
    type: oneOrMany({ type: 'string', enum: ['Person', 'Organization', 'Software'] }),
    name: oneOrMany(string),
    nickname: string,
    email: oneOrMany(string),
    email_sha1: oneOrMany(string),
    homepage: oneOrMany(iri),
  },
});

export const ExternalResource = schema('ExternalResource', {
  description: 'A body or target identified by IRI, with optional description.',
  type: 'object',
  required: ['id'],
  properties: {
    id: iri,
    type: oneOrMany(string),
    format: oneOrMany(string),
    language: oneOrMany(string),
    processingLanguage: string,
    textDirection: { type: 'string', enum: ['ltr', 'rtl', 'auto'] },
    accessibility: oneOrMany(string),
    rights: oneOrMany(iri),
    canonical: iri,
    via: oneOrMany(iri),
  },
});

export const TextQuoteSelector = schema('TextQuoteSelector', {
  type: 'object',
  required: ['type', 'exact'],
  properties: {
    type: { const: 'TextQuoteSelector' },
    exact: string,
    prefix: string,
    suffix: string,
    ...refinedBy,
  },
});

export const TextPositionSelector = schema('TextPositionSelector', {
  description: 'Offsets count Unicode code points of the scope’s normalized text (ADR 0012).',
  type: 'object',
  required: ['type', 'start', 'end'],
  properties: {
    type: { const: 'TextPositionSelector' },
    start: { type: 'integer', minimum: 0 },
    end: { type: 'integer', minimum: 0 },
    ...refinedBy,
  },
});

export const FragmentSelector = schema('FragmentSelector', {
  type: 'object',
  required: ['type', 'value'],
  properties: {
    type: { const: 'FragmentSelector' },
    value: string,
    conformsTo: iri,
    ...refinedBy,
  },
});

export const CssSelector = schema('CssSelector', {
  type: 'object',
  required: ['type', 'value'],
  properties: { type: { const: 'CssSelector' }, value: string, ...refinedBy },
});

export const XPathSelector = schema('XPathSelector', {
  type: 'object',
  required: ['type', 'value'],
  properties: { type: { const: 'XPathSelector' }, value: string, ...refinedBy },
});

export const DataPositionSelector = schema('DataPositionSelector', {
  type: 'object',
  required: ['type', 'start', 'end'],
  properties: {
    type: { const: 'DataPositionSelector' },
    start: { type: 'integer', minimum: 0 },
    end: { type: 'integer', minimum: 0 },
    ...refinedBy,
  },
});

export const SvgSelector = schema('SvgSelector', {
  type: 'object',
  required: ['type'],
  properties: { type: { const: 'SvgSelector' }, id: iri, value: string, ...refinedBy },
});

export const RangeSelector = schema('RangeSelector', {
  type: 'object',
  required: ['type', 'startSelector', 'endSelector'],
  properties: {
    type: { const: 'RangeSelector' },
    startSelector: ref('Selector'),
    endSelector: ref('Selector'),
    ...refinedBy,
  },
});

export const Selector = schema('Selector', {
  oneOf: [
    ref('TextQuoteSelector'),
    ref('TextPositionSelector'),
    ref('FragmentSelector'),
    ref('CssSelector'),
    ref('XPathSelector'),
    ref('DataPositionSelector'),
    ref('SvgSelector'),
    ref('RangeSelector'),
  ],
});

export const State = schema('State', {
  oneOf: [
    {
      type: 'object',
      required: ['type'],
      properties: {
        type: { const: 'TimeState' },
        sourceDate: oneOrMany(dateTime),
        sourceDateStart: dateTime,
        sourceDateEnd: dateTime,
        cached: oneOrMany(iri),
        refinedBy: oneOrMany(ref('State')),
      },
    },
    {
      type: 'object',
      required: ['type', 'value'],
      properties: {
        type: { const: 'HttpRequestState' },
        value: string,
        refinedBy: oneOrMany(ref('State')),
      },
    },
  ],
});

const specificResourceProperties: JsonSchema = {
  id: iri,
  type: { const: 'SpecificResource' },
  source: { anyOf: [iri, ref('ExternalResource')] },
  selector: oneOrMany(ref('Selector')),
  state: oneOrMany(ref('State')),
  styleClass: oneOrMany(string),
  renderedVia: oneOrMany({ anyOf: [iri, ref('Agent')] }),
  scope: oneOrMany(iri),
  purpose: oneOrMany(ref('Motivation')),
};

export const SpecificResource = schema('SpecificResource', {
  type: 'object',
  required: ['source'],
  properties: specificResourceProperties,
});

export const AnchoringState = schema('AnchoringState', {
  type: 'string',
  enum: [...ANCHORING_STATES],
});

export const Anchoring = schema('Anchoring', {
  description:
    'Extension (ADR 0010): how the target currently anchors. A repair carries the selectors a user chose; the target’s own selectors are never rewritten.',
  type: 'object',
  required: ['state'],
  properties: {
    state: ref('AnchoringState'),
    repair: {
      type: 'object',
      required: ['selector', 'created'],
      properties: {
        selector: oneOrMany(ref('Selector')),
        creator: { anyOf: [iri, ref('Agent')] },
        created: dateTime,
      },
    },
  },
});

export const AnchoredTarget = schema('AnchoredTarget', {
  description: 'A SpecificResource target with anchoring state.',
  type: 'object',
  required: ['source'],
  properties: { ...specificResourceProperties, anchoring: ref('Anchoring') },
});

const embeddedBodyCommon: JsonSchema = {
  id: iri,
  purpose: oneOrMany(ref('Motivation')),
  creator: { anyOf: [iri, ref('Agent')] },
  created: dateTime,
  modified: dateTime,
};

export const TextualBody = schema('TextualBody', {
  type: 'object',
  required: ['type', 'value'],
  properties: {
    type: { const: 'TextualBody' },
    value: string,
    format: string,
    language: oneOrMany(string),
    processingLanguage: string,
    textDirection: { type: 'string', enum: ['ltr', 'rtl', 'auto'] },
    ...embeddedBodyCommon,
  },
});

export const StructuredBody = schema('StructuredBody', {
  description:
    'Extension: an embedded JSON value validated against the JSON Schema registered for `profile` (docs/body-profiles.md).',
  type: 'object',
  required: ['type', 'profile', 'value'],
  properties: {
    type: { const: 'StructuredBody' },
    profile: iri,
    value: {},
    ...embeddedBodyCommon,
  },
});

export const Body = schema('Body', {
  anyOf: [
    iri,
    ref('TextualBody'),
    ref('StructuredBody'),
    ref('SpecificResource'),
    ref('ExternalResource'),
    {
      type: 'object',
      required: ['type', 'items'],
      properties: { type: { const: 'Choice' }, items: { type: 'array', items: ref('Body') } },
    },
  ],
});

export const Target = schema('Target', {
  anyOf: [
    iri,
    ref('AnchoredTarget'),
    ref('ExternalResource'),
    {
      type: 'object',
      required: ['type', 'items'],
      properties: { type: { const: 'Choice' }, items: { type: 'array', items: ref('Target') } },
    },
  ],
});

export const Permission = schema('Permission', { type: 'string', enum: [...PERMISSIONS] });

const annotationProperties: JsonSchema = {
  type: {
    anyOf: [
      { const: 'Annotation' },
      { type: 'array', minItems: 1, items: string, contains: { const: 'Annotation' } },
    ],
  },
  body: oneOrMany(ref('Body')),
  bodyValue: string,
  target: oneOrMany(ref('Target')),
  motivation: oneOrMany(ref('Motivation')),
  generator: { anyOf: [iri, ref('Agent')] },
  generated: dateTime,
  audience: oneOrMany({ anyOf: [iri, { type: 'object' }] }),
  rights: oneOrMany(iri),
  canonical: iri,
  via: oneOrMany(iri),
  stylesheet: {
    anyOf: [
      iri,
      {
        type: 'object',
        required: ['type'],
        properties: { type: { const: 'CssStylesheet' }, id: iri, value: string },
      },
    ],
  },
};

const context: JsonSchema = oneOrMany({ anyOf: [iri, { type: 'object' }] });

export const Annotation = schema('Annotation', {
  description: 'An annotation as the server returns it.',
  type: 'object',
  required: ['@context', 'id', 'type', 'target'],
  properties: {
    '@context': context,
    id: iri,
    creator: { anyOf: [iri, ref('Agent')] },
    created: dateTime,
    modified: dateTime,
    permissions: { type: 'array', items: ref('Permission') },
    ...annotationProperties,
  },
});

export const AnnotationInput = schema('AnnotationInput', {
  description:
    'An annotation as a client sends it. The server assigns id, creator, created and modified and ignores any it receives.',
  type: 'object',
  required: ['type', 'target'],
  properties: { '@context': context, ...annotationProperties },
});

/** Every schema, keyed by name, in dependency-safe order for `ajv.addSchema`. */
export const annotationSchemas: Record<string, JsonSchema> = {
  Motivation,
  Agent,
  ExternalResource,
  TextQuoteSelector,
  TextPositionSelector,
  FragmentSelector,
  CssSelector,
  XPathSelector,
  DataPositionSelector,
  SvgSelector,
  RangeSelector,
  Selector,
  State,
  SpecificResource,
  AnchoringState,
  Anchoring,
  AnchoredTarget,
  TextualBody,
  StructuredBody,
  Body,
  Target,
  Permission,
  Annotation,
  AnnotationInput,
};
