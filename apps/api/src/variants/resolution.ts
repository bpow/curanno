/**
 * The `variant` resolver: the Allele Registry lookup in the shape every resolver
 * answers with (ADR 0039). Candidates fill `caid`, `clinVarId` and `gnomad`.
 */
import type { Resolution, ResolutionCandidate, Resolver } from '../resolvers.js';
import type { VariantCandidate, VariantResolution, VariantResolver } from './resolver.js';

const SERVICES = { registry: 'Allele Registry', variantvalidator: 'VariantValidator' } as const;

/** Query warnings that say the lookup assumed the MANE Select transcript or its version. */
const ASSUMPTIONS = new Set(['transcript-assumed', 'version-assumed']);

/** Candidate warnings that do not make the candidate doubtful. */
const HARMLESS = new Set(['no-clinvar']);

/**
 * Whether a program may fill this candidate without a curator: it is the only one, it is
 * registered, nothing was found wrong, and if the lookup assumed the transcript or its
 * version, the article's protein change agrees.
 */
function autoFillable(result: VariantResolution, c: VariantCandidate): boolean {
  return (
    result.candidates.length === 1 &&
    c.caid !== undefined &&
    result.warnings.every((w) => ASSUMPTIONS.has(w.code)) &&
    (result.warnings.length === 0 || c.proteinConfirmed === true) &&
    c.warnings.every((w) => HARMLESS.has(w.code))
  );
}

function candidate(result: VariantResolution, c: VariantCandidate): ResolutionCandidate {
  const fill: Record<string, string> = {};
  if (c.caid) fill['caid'] = c.caid;
  // Which of several ClinVar variations is meant is a curator's choice.
  if (c.clinVar.length === 1) fill['clinVarId'] = c.clinVar[0]!.variationId;
  if (c.gnomad) fill['gnomad'] = c.gnomad;
  const one = (label: string, text: string | undefined) =>
    text ? [{ label, values: [{ text }] }] : [];
  return {
    label: c.title ?? c.hgvs.transcript ?? c.hgvs.genomic ?? 'Unnamed allele',
    fill,
    facts: [
      {
        label: 'CAID',
        values: c.caid ? [{ text: c.caid, ...(c.registryUrl ? { url: c.registryUrl } : {}) }] : [],
      },
      { label: 'ClinVar', values: c.clinVar.map((v) => ({ text: v.variationId, url: v.url })) },
      ...one('gnomAD', c.gnomad),
      ...one('GRCh38', c.hgvs.genomic),
      ...one('Protein', c.hgvs.protein),
    ],
    ...(autoFillable(result, c) ? { autoFill: true as const } : {}),
    warnings: c.warnings,
  };
}

export function toResolution(result: VariantResolution): Resolution {
  return {
    query: result.query,
    context: result.gene ? { gene: result.gene } : {},
    candidates: result.candidates.map((c) => candidate(result, c)),
    warnings: result.warnings,
    steps: result.steps.map((s) => ({ ...s, service: SERVICES[s.service] })),
  };
}

export function variantResolver(lookup: VariantResolver): Resolver {
  return {
    resolve: async (query, context) => toResolution(await lookup.resolve(query, context['gene'])),
  };
}
