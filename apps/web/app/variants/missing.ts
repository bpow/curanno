/**
 * Case-variant facts that still need their Allele Registry or ClinVar IDs
 * (ADR 0039, docs/variant-ids-plan.md), grouped by the variant as written,
 * so that a curator settles a variant once for every article that reports it.
 */
import type { Annotation, components } from '@curanno/api-client';
import {
  annotationUuid,
  caseVariantProfile,
  documentOf,
  lookupFieldsOf,
  needsLookup,
  quoteOf,
  structuredBodies,
  withLookedUp,
  withUnresolvable,
  type JsonValue,
  type StructuredBody,
} from '@curanno/model';

export type Candidate = components['schemas']['ResolutionCandidate'];

/** One case-variant fact without IDs. */
export interface MissingFact {
  /** The annotation's IRI. */
  iri: string;
  uuid: string;
  /** The document the fact is on. */
  source: string;
  /** The text the fact is anchored to, when it has a quote. */
  quote?: string;
  /** Whether the caller may edit it. */
  writable: boolean;
}

/** Facts reporting the same variant in the same gene. */
export interface MissingVariant {
  key: string;
  variant: string;
  /** The gene the facts name, when they agree on one. */
  gene?: string;
  facts: MissingFact[];
}

type Value = Record<string, JsonValue>;

/** The case-variant profile's variant field and the lookup it offers. */
export const { field: VARIANT, lookup: LOOKUP } = lookupFieldsOf(caseVariantProfile.schema)[0]!;
const GENE = LOOKUP.context?.['gene'] ?? '';

function variantBody(annotation: Annotation): (StructuredBody & { value: Value }) | undefined {
  return structuredBodies(annotation).find(
    (body): body is StructuredBody & { value: Value } =>
      body.profile === caseVariantProfile.iri &&
      typeof body.value === 'object' &&
      body.value !== null &&
      !Array.isArray(body.value),
  );
}

const text = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : undefined;

/** The identity used to group facts and check that a fact still belongs to its original group. */
export function variantKey(value: Value): string {
  return `${text(value[GENE])?.toUpperCase() ?? ''}\u0000${text(value[VARIANT]) ?? ''}`;
}

/** Whether a case-variant value still needs IDs: none given, and not marked unresolvable. */
export function needsIds(value: Value): boolean {
  return needsLookup(value, VARIANT, LOOKUP);
}

/** The facts among these annotations that need IDs, grouped by variant and gene, most facts first. */
export function missingVariants(annotations: readonly Annotation[]): MissingVariant[] {
  const groups = new Map<string, MissingVariant>();
  for (const annotation of annotations) {
    const body = variantBody(annotation);
    if (!body || !needsIds(body.value)) continue;
    const variant = text(body.value[VARIANT])!;
    const gene = text(body.value[GENE])?.toUpperCase();
    const key = variantKey(body.value);
    const group = groups.get(key) ?? { key, variant, ...(gene ? { gene } : {}), facts: [] };
    const quote = quoteOf(annotation);
    group.facts.push({
      iri: annotation.id,
      uuid: annotationUuid(annotation.id),
      source: documentOf(annotation) ?? '',
      ...(quote ? { quote } : {}),
      writable: (annotation.permissions ?? []).includes('update'),
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.facts.length - a.facts.length || a.variant.localeCompare(b.variant),
  );
}

/** The value with a candidate's IDs, as the sidebar's Use these IDs fills them. */
export function withCandidate(value: Value, candidate: Candidate): Value {
  return withLookedUp(value, LOOKUP, candidate.fill);
}

/** The value marked unresolvable, without IDs. */
export function unresolvable(value: Value): Value {
  return withUnresolvable(value, LOOKUP);
}

const SERVER_ASSIGNED = new Set([
  '@context',
  'id',
  'creator',
  'created',
  'modified',
  'permissions',
  'public',
]);

/**
 * The annotation as an update sends it, with its case-variant body's value changed.
 * Other bodies, and the case-variant body's creator (ADR 0034), stay as they are.
 */
export function updatedInput(
  annotation: Annotation,
  change: (value: Value) => Value,
): Record<string, unknown> | undefined {
  const body = variantBody(annotation);
  if (!body) return undefined;
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(annotation)) {
    if (!SERVER_ASSIGNED.has(key)) input[key] = value;
  }
  const replace = (b: unknown) => (b === body ? { ...body, value: change(body.value) } : b);
  input['body'] = Array.isArray(annotation.body)
    ? (annotation.body as unknown[]).map(replace)
    : replace(annotation.body);
  return input;
}
