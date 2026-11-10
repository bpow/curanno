import type { BodyProfile } from './registry.js';

/** Base IRI of built-in profiles. Provisional, like the project name. */
export const PROFILE_BASE = 'https://curanno.example/profiles/';

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

const text = (title: string, description: string, maxLength = 200) => ({
  title,
  description,
  type: 'string',
  minLength: 1,
  maxLength,
});

const hpoList = (title: string, description: string) => ({
  title,
  description,
  type: 'array',
  items: { type: 'string', pattern: '^HP:[0-9]{7}$' },
  uniqueItems: true,
});

/**
 * An individual reported in an article with a variant in the gene of interest,
 * after the Case-Individuals template of the ClinGen Hypothes.is annotation
 * overview (v1). Titles keep the template's CamelCase labels so that curators
 * trained on it recognise the fields. The template's "n/a" convention becomes
 * an omitted field, and MultipleGeneVariants becomes the `variants` list.
 */
export const caseIndividualProfile: BodyProfile = {
  iri: `${PROFILE_BASE}case-individual/1`,
  title: 'Case individual',
  description:
    'An individual reported to have a variant in the gene of interest (ClinGen Case-Individuals template).',
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${PROFILE_BASE}case-individual/1`,
    type: 'object',
    required: ['case', 'variants'],
    additionalProperties: false,
    properties: {
      case: text(
        'Case',
        'How the article identifies the individual, for example "Patient 3" or "II-1".',
      ),
      diseaseAssertion: text(
        'DiseaseAssertion',
        'The disease or diagnosis asserted for the individual.',
        2000,
      ),
      familyInfo: text(
        'FamilyInfo',
        'Family history, consanguinity, segregation or affected relatives.',
        2000,
      ),
      casePresentingHpos: hpoList(
        'CasePresentingHPOs',
        'HPO terms for the phenotypes present, for example HP:0001639.',
      ),
      caseHpoFreeText: text(
        'CaseHPOFreeText',
        'Phenotypes present, as described in the article.',
        2000,
      ),
      caseNotHpos: hpoList('CaseNOTHPOs', 'HPO terms for phenotypes the article says are absent.'),
      caseNotHpoFreeText: text(
        'CaseNOTHPOFreeText',
        'Absent phenotypes, as described in the article.',
        2000,
      ),
      casePreviousTesting: text(
        'CasePreviousTesting',
        'Testing done before the genetic test that found the variant.',
        2000,
      ),
      genotypingMethod: text(
        'GenotypingMethod',
        'For example exome sequencing, a gene panel or Sanger sequencing.',
      ),
      previouslyPublished: text(
        'PreviouslyPublished',
        'Where the individual was reported before, for example PMID:12345.',
      ),
      supplementalData: text(
        'SupplementalData',
        'Where in the supplement the individual is reported.',
      ),
      variants: {
        title: 'Variants',
        description:
          'Each variant reported for the individual, in the gene of interest first. Give a ClinVarID or a CAID.',
        type: 'array',
        minItems: 1,
        items: {
          title: 'Variant',
          type: 'object',
          required: ['variant'],
          additionalProperties: false,
          properties: {
            geneName: text('GeneName', 'HGNC gene symbol, for example MYH7.', 50),
            variant: text(
              'Variant',
              'The variant as reported, preferably HGVS, for example NM_000257.4:c.1208G>A.',
            ),
            clinVarId: {
              title: 'ClinVarID',
              description: 'The numeric ClinVar Variation ID.',
              type: 'string',
              pattern: '^[0-9]+$',
              maxLength: 20,
            },
            caid: {
              title: 'CAID',
              description: 'ClinGen Allele Registry ID, for example CA000123.',
              type: 'string',
              pattern: '^CA[0-9]+$',
              maxLength: 20,
            },
            gnomad: text('gnomAD', 'The gnomAD variant ID or allele frequency.'),
            variantEvidence: text(
              'VariantEvidence',
              'Evidence about the variant itself, such as functional studies.',
              2000,
            ),
          },
        },
      },
    },
  },
};

/** Profiles compiled into every deployment. */
export const builtinProfiles: readonly BodyProfile[] = [
  evidenceExcerptProfile,
  caseIndividualProfile,
];
