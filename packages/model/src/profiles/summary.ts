/**
 * Whole-individual summaries computed from case facts (ADR 0036): one
 * `case-individual/1` value per `individual/1` annotation, built from the
 * fact annotations that link to it. Nothing here is stored; the result
 * depends only on the annotations passed in, which are those the reader can
 * see.
 */
import { structuredBodies, type AnnotationLike } from '../annotation/read.js';
import type { JsonValue, StructuredBody } from '../annotation/types.js';
import {
  caseDiseaseProfile,
  caseFamilyProfile,
  caseIndividualProfile,
  casePhenotypesProfile,
  caseTestingProfile,
  caseVariantProfile,
  individualProfile,
} from './builtin.js';
import { linkedIris } from './keywords.js';
import { stableStringify } from '../json.js';
import type { ValidationError } from './registry.js';

type Value = Record<string, JsonValue>;

export interface IndividualSummary {
  /** The `individual/1` annotation's IRI. */
  individual: string;
  /** The summary in the shape of `case-individual/1`. */
  value: Value;
  /**
   * The fact annotations behind each field of `value`. For `variants`, one
   * IRI per item, in item order.
   */
  sources: Record<string, string[]>;
  /** Every fact that links to the individual, in the order given. */
  facts: string[];
  /** Why `value` does not validate against `case-individual/1`; empty when it does. */
  errors: ValidationError[];
}

export interface Summaries {
  individuals: IndividualSummary[];
  /** Facts none of whose individuals are among the annotations given. */
  unlinked: string[];
}

/** Fact profiles and the summary fields each fills, other than `variants`. */
const FACT_FIELDS = new Map<string, readonly string[]>([
  [casePhenotypesProfile.iri, ['casePresentingHpos', 'caseNotHpos']],
  [caseFamilyProfile.iri, ['familyInfo']],
  [caseTestingProfile.iri, ['casePreviousTesting', 'genotypingMethod']],
  [caseDiseaseProfile.iri, ['diseaseAssertion']],
]);
const INDIVIDUAL_FIELDS = ['case', 'previouslyPublished', 'supplementalData'];
const VARIANT_FIELDS = [
  'geneName',
  'variant',
  'clinVarId',
  'caid',
  'gnomad',
  'idSource',
  'variantEvidence',
];
const TEXT_SEPARATOR = '; ';

function recordOf(body: StructuredBody): Value | undefined {
  const { value } = body;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function pick(value: Value, fields: readonly string[]): Value {
  return Object.fromEntries(
    fields.filter((f) => value[f] !== undefined).map((f) => [f, value[f]!]),
  );
}

/** A term is the same term when its ID is, or, for text without an ID, its label is. */
function termKey(term: JsonValue): string {
  if (typeof term === 'object' && term !== null && !Array.isArray(term)) {
    if (typeof term['id'] === 'string') return term['id'];
    if (typeof term['label'] === 'string') return `label:${term['label'].toLowerCase()}`;
  }
  return JSON.stringify(term);
}

function merge(summary: IndividualSummary, field: string, next: JsonValue, fact: string): void {
  const current = summary.value[field];
  const sources = (summary.sources[field] ??= []);
  if (current === undefined) {
    summary.value[field] = next;
  } else if (Array.isArray(current) && Array.isArray(next)) {
    const keys = new Set(current.map(termKey));
    const added = next.filter((t) => !keys.has(termKey(t)));
    if (!added.length) return;
    summary.value[field] = [...current, ...added];
  } else if (typeof current === 'string' && typeof next === 'string') {
    if (current.split(TEXT_SEPARATOR).includes(next)) return;
    summary.value[field] = `${current}${TEXT_SEPARATOR}${next}`;
  } else {
    return;
  }
  if (!sources.includes(fact)) sources.push(fact);
}

function addFact(summary: IndividualSummary, id: string, body: StructuredBody, value: Value): void {
  if (!summary.facts.includes(id)) summary.facts.push(id);
  if (body.profile === caseVariantProfile.iri) {
    const item = pick(value, VARIANT_FIELDS);
    const variants = (summary.value['variants'] ?? []) as JsonValue[];
    if (variants.some((v) => stableStringify(v) === stableStringify(item))) return;
    summary.value['variants'] = [...variants, item];
    (summary.sources['variants'] ??= []).push(id);
    return;
  }
  for (const field of FACT_FIELDS.get(body.profile) ?? []) {
    const next = value[field];
    if (next !== undefined) merge(summary, field, next, id);
  }
}

export function summarizeIndividuals(
  annotations: Iterable<AnnotationLike & { id: string }>,
  validate?: (body: StructuredBody) => ValidationError[],
): Summaries {
  const byIndividual = new Map<string, IndividualSummary>();
  const facts: { id: string; body: StructuredBody; value: Value }[] = [];

  for (const annotation of annotations) {
    const { id } = annotation;
    for (const body of structuredBodies(annotation)) {
      const value = recordOf(body);
      if (!value) continue;
      if (body.profile === individualProfile.iri) {
        if (byIndividual.has(id)) continue;
        const own = pick(value, INDIVIDUAL_FIELDS);
        byIndividual.set(id, {
          individual: id,
          value: own,
          sources: Object.fromEntries(Object.keys(own).map((f) => [f, [id]])),
          facts: [],
          errors: [],
        });
      } else if (body.profile === caseVariantProfile.iri || FACT_FIELDS.has(body.profile)) {
        facts.push({ id, body, value });
      }
    }
  }

  const unlinked: string[] = [];
  for (const { id, body, value } of facts) {
    const linked = linkedIris(value['individuals']).flatMap((link) => {
      const summary = byIndividual.get(link);
      return summary ? [summary] : [];
    });
    if (!linked.length && !unlinked.includes(id)) unlinked.push(id);
    for (const summary of linked) addFact(summary, id, body, value);
  }

  const individuals = [...byIndividual.values()];
  if (validate) {
    for (const summary of individuals) {
      summary.errors = validate({
        type: 'StructuredBody',
        profile: caseIndividualProfile.iri,
        value: summary.value,
      });
    }
  }
  return { individuals, unlinked };
}
