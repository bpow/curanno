/**
 * Turns an AnnotationInput into the rows the schema stores: annotation-level
 * properties the server queries (motivation), everything else as JSONB, one
 * row per body and per target. The split is reversed by serialize.ts; the
 * two must agree so that annotations round-trip (ADR 0011).
 */
import {
  isIri,
  type AnchoringRepair,
  type AnchoringState,
  type AnnotationInput,
  type Body,
  type Selector,
  type Target,
} from '@curanno/model';
import { unprocessable } from '../problems.js';

/** Marks in `targets.data` how the target was expressed, so it is returned the same way. */
export const TARGET_SHAPE = '$shape';
export type TargetShape = 'iri' | 'external' | 'specific';

export interface ParsedTarget {
  source: string;
  selectors: Selector | Selector[] | null;
  anchoringState: AnchoringState;
  repair: AnchoringRepair | null;
  data: Record<string, unknown>;
}

export interface ParsedAnnotation {
  motivation: string[];
  bodies: Body[];
  targets: ParsedTarget[];
  /** Annotation properties stored as JSONB: type (when extended), generator, rights, extensions. */
  data: Record<string, unknown>;
}

const SERVER_ASSIGNED = new Set([
  '@context',
  'id',
  'type',
  'body',
  'target',
  'motivation',
  'creator',
  'created',
  'modified',
  'permissions',
]);

/**
 * The annotation's own `@context` is the server's to set; a context nested in
 * a body, target or extension would be stored and echoed, and a JSON-LD
 * consumer would dereference it. Rejected at any depth.
 */
function rejectNestedContexts(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => rejectNestedContexts(item, `${path}/${i}`));
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === '@context') throw unprocessable(`${path}/@context: a context may not be nested`);
      rejectNestedContexts(inner, `${path}/${key}`);
    }
  }
}

export function parseAnnotationInput(input: AnnotationInput): ParsedAnnotation {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SERVER_ASSIGNED.has(key)) data[key] = value;
    if (key !== '@context') rejectNestedContexts(value, `/${key}`);
  }
  if (Array.isArray(input.type) && input.type.length > 1) data['type'] = input.type;

  const targets = toArray(input.target);
  if (targets.length === 0) throw unprocessable('an annotation needs at least one target');
  return {
    motivation: toArray(input.motivation),
    bodies: toArray(input.body),
    targets: targets.map((t, i) => parseTarget(t, `/target/${i}`)),
    data,
  };
}

function parseTarget(target: Target, path: string): ParsedTarget {
  if (typeof target === 'string') {
    if (!isIri(target)) throw unprocessable(`${path} is not an IRI`);
    return {
      source: target,
      selectors: null,
      anchoringState: 'anchored',
      repair: null,
      data: { [TARGET_SHAPE]: 'iri' satisfies TargetShape },
    };
  }
  if ('items' in target) {
    throw unprocessable(`${path}: Choice targets are not supported`);
  }
  if ('source' in target) {
    const { source, selector, anchoring, ...rest } = target;
    const sourceIri = typeof source === 'string' ? source : source.id;
    if (!isIri(sourceIri)) throw unprocessable(`${path}/source is not an IRI`);
    const state = anchoring?.state ?? 'anchored';
    const repair = anchoring?.repair ?? null;
    if ((state === 'repaired') !== (repair !== null)) {
      throw unprocessable(
        `${path}/anchoring: a repair is present exactly when the state is "repaired"`,
      );
    }
    return {
      source: sourceIri,
      selectors: selector ?? null,
      anchoringState: state,
      repair,
      data: {
        ...rest,
        ...(typeof source === 'string' ? {} : { source }),
        [TARGET_SHAPE]: 'specific' satisfies TargetShape,
      },
    };
  }
  const { id, ...rest } = target;
  if (!isIri(id)) throw unprocessable(`${path}/id is not an IRI`);
  return {
    source: id,
    selectors: null,
    anchoringState: 'anchored',
    repair: null,
    data: { ...rest, [TARGET_SHAPE]: 'external' satisfies TargetShape },
  };
}

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Deterministic JSON for comparing selectors regardless of key order. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
