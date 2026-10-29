import type { BodyProfile } from './registry.js';

/** Base IRI of built-in profiles. Provisional, like the project name. */
export const PROFILE_BASE = 'https://scale.example/profiles/';

/**
 * Proof-of-concept structured profile: an excerpt tagged as evidence of a
 * given kind, with identifiers for what it is evidence about. The curation
 * team defines the real profiles; this one exists so that the registry, the
 * server's validation and the sidebar's editor have something to build on.
 */
export const evidenceExcerptProfile: BodyProfile = {
  iri: `${PROFILE_BASE}evidence-excerpt/1`,
  title: 'Evidence excerpt',
  description:
    'Classifies the annotated text as evidence of a kind, linked to the entities it concerns by CURIE.',
  purposes: ['classifying'],
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${PROFILE_BASE}evidence-excerpt/1`,
    type: 'object',
    required: ['kind'],
    additionalProperties: false,
    properties: {
      kind: {
        description: 'The kind of evidence the excerpt provides.',
        type: 'string',
        enum: ['case', 'functional', 'segregation', 'population', 'computational', 'other'],
      },
      identifiers: {
        description:
          'CURIEs for the entities the evidence concerns, for example PMID:12345 or HGNC:1100.',
        type: 'array',
        items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_.]*:\\S+$' },
        uniqueItems: true,
      },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      summary: { type: 'string', maxLength: 2000 },
    },
  },
};

/** Profiles compiled into every deployment. */
export const builtinProfiles: readonly BodyProfile[] = [evidenceExcerptProfile];
