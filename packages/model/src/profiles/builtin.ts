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
  defaultPurpose: 'classifying',
  purposes: ['classifying'],
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${PROFILE_BASE}evidence-excerpt/1`,
    type: 'object',
    required: ['kind'],
    additionalProperties: false,
    properties: {
      kind: {
        description:
          'The kind of evidence the excerpt provides, for example functional, segregation or population.',
        type: 'string',
        minLength: 1,
        maxLength: 200,
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

// A phenotype picked from HPO keeps its ID and the label it had then; text HPO has no term for is only a label.
const phenotypeList = (title: string, description: string) => ({
  title,
  description,
  type: 'array',
  ontology: { name: 'hp', root: 'HP:0000118' },
  items: {
    type: 'object',
    required: ['label'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', pattern: '^HP:[0-9]{7}$' },
      label: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
  uniqueItems: true,
});

// Fields shared by the whole-individual summary and the facts it is computed from.
const fields = {
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
  casePresentingHpos: phenotypeList(
    'CasePresentingHPOs',
    'Phenotypes present. Pick HPO terms; text that matches none is kept as written.',
  ),
  caseNotHpos: phenotypeList(
    'CaseNOTHPOs',
    'Phenotypes the article says are absent. Pick HPO terms; text that matches none is kept as written.',
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
  supplementalData: text('SupplementalData', 'Where in the supplement the individual is reported.'),
};

const variantProperties = {
  geneName: text('GeneName', 'HGNC gene symbol, for example MYH7.', 50),
  variant: {
    ...text(
      'Variant',
      'The variant as reported, preferably HGVS, for example NM_000257.4:c.1208G>A.',
    ),
    // A gnomAD ID alone does not satisfy the ClinGen template, so it is not one of the IDs.
    lookup: {
      resolver: 'variant',
      context: { gene: 'geneName' },
      fill: { caid: 'caid', clinVarId: 'clinVarId', gnomad: 'gnomad' },
      ids: ['caid', 'clinVarId'],
      source: 'idSource',
    },
  },
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
  // Added to version 1 because it is optional: every stored body still validates (ADR 0039).
  idSource: {
    title: 'IDSource',
    description:
      'Where the ClinVarID and CAID come from: stated in the article, looked up in the Allele Registry, or unresolvable when there are none to find.',
    type: 'string',
    enum: ['stated', 'looked up', 'unresolvable'],
  },
};

/**
 * An individual reported in an article with a variant in the gene of interest,
 * after the Case-Individuals template of the ClinGen Hypothes.is annotation
 * overview (v1). Titles keep the template's CamelCase labels so that curators
 * trained on it recognise the fields. The template's "n/a" convention becomes
 * an omitted field, MultipleGeneVariants becomes the `variants` list, and
 * each HPO list also holds the free text its CaseHPOFreeText field held.
 *
 * New work records facts where they appear (ADR 0035), and this shape is
 * computed from them (ADR 0036), so editors no longer offer it.
 */
export const caseIndividualProfile: BodyProfile = {
  iri: `${PROFILE_BASE}case-individual/1`,
  title: 'Case individual',
  description:
    'An individual reported to have a variant in the gene of interest (ClinGen Case-Individuals template).',
  defaultPurpose: 'describing',
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${PROFILE_BASE}case-individual/1`,
    type: 'object',
    derived: true,
    required: ['case', 'variants'],
    additionalProperties: false,
    properties: {
      ...fields,
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
          properties: variantProperties,
        },
      },
    },
  },
};

/** Where the article first describes an individual; facts about them link here (ADR 0035). */
export const individualProfile: BodyProfile = {
  iri: `${PROFILE_BASE}individual/1`,
  title: 'Individual',
  description:
    'Where the article first describes a case individual. Facts about the individual link to this annotation.',
  defaultPurpose: 'identifying',
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${PROFILE_BASE}individual/1`,
    type: 'object',
    required: ['case'],
    additionalProperties: false,
    properties: {
      case: fields.case,
      previouslyPublished: fields.previouslyPublished,
      supplementalData: fields.supplementalData,
    },
  },
};

// An IRI of any scheme; the `annotation` keyword says what it should name.
const IRI_PATTERN = '^[A-Za-z][A-Za-z0-9+.-]*:[^\\s]+$';

function factProfile(
  slug: string,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): BodyProfile {
  const iri = `${PROFILE_BASE}${slug}/1`;
  return {
    iri,
    title,
    description,
    defaultPurpose: 'describing',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: iri,
      type: 'object',
      required: ['individuals', ...required],
      // A fact states something beyond whom it is about.
      minProperties: 2,
      additionalProperties: false,
      properties: {
        individuals: {
          title: 'Individuals',
          description: 'The annotations that introduce the individuals the passage is about.',
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', pattern: IRI_PATTERN, maxLength: 2000 },
          annotation: { profile: individualProfile.iri, label: 'case' },
        },
        ...properties,
      },
    },
  };
}

export const caseVariantProfile = factProfile(
  'case-variant',
  'Case variant',
  'A variant the passage reports for one or more individuals.',
  variantProperties,
  ['variant'],
);

export const casePhenotypesProfile = factProfile(
  'case-phenotypes',
  'Case phenotypes',
  'Phenotypes the passage reports as present or absent in one or more individuals, and their course.',
  {
    casePresentingHpos: fields.casePresentingHpos,
    caseNotHpos: fields.caseNotHpos,
    course: text('Course', 'Onset, progression or resolution of the phenotypes.', 2000),
  },
);

export const caseFamilyProfile = factProfile(
  'case-family',
  'Case family history',
  'What the passage says about the family of one or more individuals.',
  { familyInfo: fields.familyInfo },
  ['familyInfo'],
);

export const caseTestingProfile = factProfile(
  'case-testing',
  'Case testing',
  'Testing of one or more individuals: earlier tests, and how the variant was found.',
  {
    casePreviousTesting: fields.casePreviousTesting,
    genotypingMethod: fields.genotypingMethod,
  },
);

export const caseDiseaseProfile = factProfile(
  'case-disease',
  'Case disease',
  'The disease or diagnosis the passage asserts for one or more individuals.',
  { diseaseAssertion: fields.diseaseAssertion },
  ['diseaseAssertion'],
);

/** Profiles compiled into every deployment. */
export const builtinProfiles: readonly BodyProfile[] = [
  evidenceExcerptProfile,
  caseIndividualProfile,
  individualProfile,
  caseVariantProfile,
  casePhenotypesProfile,
  caseFamilyProfile,
  caseTestingProfile,
  caseDiseaseProfile,
];
