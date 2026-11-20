/** Validate the upstream fields the lookup reads; unrelated fields remain allowed. */
import { Ajv2020, type AnySchemaObject } from 'ajv/dist/2020.js';

const ajv = new Ajv2020();
const text = { type: 'string' };
const id = { anyOf: [text, { type: 'number' }] };
const object = (
  properties: Record<string, AnySchemaObject>,
  required: string[] = [],
): AnySchemaObject => ({ type: 'object', properties, required });
const array = (items: AnySchemaObject): AnySchemaObject => ({ type: 'array', items });
const hgvs = { ...array(text), minItems: 1 };
const refSeq = object({ RefSeq: object({ hgvs: text }) });

export const validAllele = ajv.compile({
  ...object({
    '@id': text,
    communityStandardTitle: array(text),
    genomicAlleles: array(object({ referenceGenome: text, hgvs }, ['hgvs'])),
    transcriptAlleles: array(
      object(
        {
          geneSymbol: text,
          hgvs,
          MANE: object({ maneStatus: text, nucleotide: refSeq, protein: refSeq }),
        },
        ['hgvs'],
      ),
    ),
    aminoAcidAlleles: array(
      object(
        {
          geneSymbol: text,
          hgvs,
          matchingRegisteredTranscripts: array(object({ '@id': text, hgvs: text })),
        },
        ['hgvs'],
      ),
    ),
    externalRecords: object({
      ClinVarVariations: array(object({ variationId: id })),
      gnomAD_4: array(object({ id: text })),
      dbSNP: array(object({ rs: id })),
    }),
  }),
  anyOf: ['genomicAlleles', 'transcriptAlleles', 'aminoAcidAlleles'].map((name) => ({
    required: [name],
    properties: { [name]: { type: 'array', minItems: 1 } },
  })),
});

const sequenceId = object({ RefSeq: object({ id: text }) });
export const validGene = ajv.compile(
  object(
    {
      externalRecords: object(
        {
          HGNC: object({ symbol: text }, ['symbol']),
          MANE: array(object({ maneStatus: text, nucleotide: sequenceId, protein: sequenceId })),
        },
        ['HGNC'],
      ),
    },
    ['externalRecords'],
  ),
);

export const validRegistryError = ajv.compile({
  ...object({ errorType: text, message: text, description: text }),
  anyOf: ['errorType', 'message', 'description'].map((name) => ({ required: [name] })),
});

export const validMapping = ajv.compile({
  ...object({ flag: text, metadata: {} }, ['flag']),
  additionalProperties: {
    if: { type: 'object' },
    then: object({
      primary_assembly_loci: {
        anyOf: [object({ grch38: object({ hgvs_genomic_description: text }) }), { type: 'null' }],
      },
      validation_warnings: array(text),
    }),
  },
});
