/**
 * Schema keywords that profiles may use beyond JSON Schema 2020-12. They
 * only annotate: validation ignores them, and editors read them to choose a
 * widget (docs/body-profiles.md).
 */

/**
 * On an array of `{id?, label}` items: offer terms of this loaded ontology
 * (docs/ontologies.md), optionally only `root` and its descendants.
 */
export interface OntologyLookup {
  name: string;
  root?: string;
}

/**
 * On a string property, or an array of strings: each value is the IRI of an
 * annotation whose structured body has `profile`. `label` names the field of
 * the linked profile that holds the linked annotation's label, so readers can
 * show it without storing it (ADR 0035).
 */
export interface AnnotationLink {
  profile: string;
  label?: string;
}

/**
 * On a string property holding something as an article names it: offer to look it up
 * with `GET /x/resolve/{resolver}` (ADR 0039).
 */
export interface FieldLookup {
  resolver: string;
  /** Each context parameter of the resolver, mapped to the sibling field that gives it. */
  context?: Record<string, string>;
  /** Each name in a candidate's `fill`, mapped to the sibling field it fills. */
  fill: Record<string, string>;
  /**
   * The fields that identify the mention; every `fill` field when absent. It needs lookup
   * while all of them are empty, and marking it unresolvable clears them.
   */
  ids?: string[];
  /** The field that records `looked up`, or `unresolvable`. */
  source?: string;
}

/** A top-level property of a profile's schema with lookup. */
export interface LookupField {
  field: string;
  lookup: FieldLookup;
}

/** The fields of a profile's schema, at its top level, that offer lookup. */
export function lookupFieldsOf(schema: Record<string, unknown>): LookupField[] {
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null) return [];
  return Object.entries(properties as Record<string, unknown>).flatMap(([field, child]) => {
    const lookup = (child as { lookup?: unknown } | null)?.lookup;
    return typeof lookup === 'object' && lookup !== null
      ? [{ field, lookup: lookup as FieldLookup }]
      : [];
  });
}

/** The fields that identify a looked-up mention. */
export function idFieldsOf(lookup: FieldLookup): string[] {
  return lookup.ids ?? Object.values(lookup.fill);
}

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** The resolver's context, from the sibling fields that give it. */
export function lookupContext(
  value: Record<string, unknown>,
  lookup: FieldLookup,
): Record<string, string> {
  const context: Record<string, string> = {};
  for (const [param, name] of Object.entries(lookup.context ?? {})) {
    const given = value[name];
    if (filled(given)) context[param] = given.trim();
  }
  return context;
}

/**
 * The value with a candidate's values in every field the lookup fills, so none is left
 * from another candidate.
 */
export function withLookedUp<T extends Record<string, unknown>>(
  value: T,
  lookup: FieldLookup,
  fill: Readonly<Record<string, string>>,
): T {
  const next: Record<string, unknown> = { ...value };
  for (const [key, name] of Object.entries(lookup.fill)) {
    if (fill[key] === undefined) delete next[name];
    else next[name] = fill[key];
  }
  if (lookup.source) next[lookup.source] = 'looked up';
  return next as T;
}

/** The value marked unresolvable, without IDs. */
export function withUnresolvable<T extends Record<string, unknown>>(
  value: T,
  lookup: FieldLookup,
): T {
  const next: Record<string, unknown> = { ...value };
  for (const name of idFieldsOf(lookup)) delete next[name];
  if (lookup.source) next[lookup.source] = 'unresolvable';
  return next as T;
}

/** Whether a mention still needs lookup: it has text, no IDs, and is not marked unresolvable. */
export function needsLookup(
  value: Record<string, unknown>,
  field: string,
  lookup: FieldLookup,
): boolean {
  return (
    filled(value[field]) &&
    !idFieldsOf(lookup).some((name) => value[name] !== undefined) &&
    !(lookup.source && value[lookup.source] === 'unresolvable')
  );
}

/** Whether a candidate gives an ID, rather than only other values. */
export function givesIds(lookup: FieldLookup, fill: Readonly<Record<string, string>>): boolean {
  const ids = new Set(idFieldsOf(lookup));
  return Object.entries(lookup.fill).some(
    ([key, name]) => ids.has(name) && fill[key] !== undefined,
  );
}

/** A top-level property of a profile's schema that links to other annotations. */
export interface SchemaLink {
  field: string;
  link: AnnotationLink;
  /** The field holds a list of links rather than one. */
  multiple: boolean;
}

/** The link fields of a profile's schema, at its top level (ADR 0035). */
export function linkFieldsOf(schema: Record<string, unknown>): SchemaLink[] {
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null) return [];
  return Object.entries(properties as Record<string, unknown>).flatMap(([field, child]) => {
    if (typeof child !== 'object' || child === null) return [];
    const { annotation, type } = child as { annotation?: unknown; type?: unknown };
    if (typeof annotation !== 'object' || annotation === null) return [];
    return [{ field, link: annotation as AnnotationLink, multiple: type === 'array' }];
  });
}

/** The IRIs a link field's value names, whether it holds one or a list. */
export function linkedIris(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Minimal view of an Ajv instance, so this package does not depend on Ajv's types. */
export interface KeywordRegistry {
  addKeyword(definition: { keyword: string; metaSchema?: object }): unknown;
}

export function addProfileKeywords<T extends KeywordRegistry>(ajv: T): T {
  ajv.addKeyword({
    keyword: 'ontology',
    metaSchema: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', pattern: '^[a-z][a-z0-9]*$' },
        root: { type: 'string' },
      },
    },
  });
  ajv.addKeyword({
    keyword: 'annotation',
    metaSchema: {
      type: 'object',
      required: ['profile'],
      additionalProperties: false,
      properties: { profile: { type: 'string' }, label: { type: 'string' } },
    },
  });
  const names = { type: 'object', additionalProperties: { type: 'string' } };
  ajv.addKeyword({
    keyword: 'lookup',
    metaSchema: {
      type: 'object',
      required: ['resolver', 'fill'],
      additionalProperties: false,
      properties: {
        resolver: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
        context: names,
        fill: { ...names, minProperties: 1 },
        ids: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' },
      },
    },
  });
  // At a schema's root: bodies of the profile are computed, not written (ADR 0036).
  ajv.addKeyword({ keyword: 'derived', metaSchema: { type: 'boolean' } });
  return ajv;
}

/** Whether a profile's bodies are computed rather than written, so editors should not offer it. */
export function isDerived(schema: Record<string, unknown>): boolean {
  return schema['derived'] === true;
}
