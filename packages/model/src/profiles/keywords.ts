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
  return ajv;
}
