/**
 * Reading annotations in the shapes the W3C model allows (one-or-many
 * everywhere): bodies, comment, tags, targets, quote, creator and anchoring
 * state, for every client that shows annotations.
 */
import type {
  Agent,
  AnchoringState,
  Body,
  Motivation,
  OneOrMany,
  Purpose,
  Selector,
  StructuredBody,
  Target,
  TextualBody,
} from './types.js';

/**
 * The parts of an annotation the readers look at, typed loosely so that the
 * API client's generated `Annotation` fits as well as this package's.
 */
export interface AnnotationLike {
  body?: unknown;
  bodyValue?: string | undefined;
  target?: unknown;
  motivation?: unknown;
  creator?: unknown;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ANNOTATION_IRI = new RegExp(`/annotations/(${UUID})$`, 'i');
const USER_IRI = new RegExp(`/x/users/(${UUID})$`, 'i');

export function toArray<T>(value: OneOrMany<T> | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The identifier the API's path parameters take, from an annotation IRI. */
export function annotationUuid(iri: string): string {
  return ANNOTATION_IRI.exec(iri)?.[1] ?? iri;
}

export function bodiesOf(annotation: AnnotationLike): Body[] {
  return toArray(annotation.body as OneOrMany<Body> | undefined);
}

export function isStructuredBody(body: Body): body is StructuredBody {
  return typeof body === 'object' && body !== null && body.type === 'StructuredBody';
}

export function isTextualBody(body: Body): body is TextualBody {
  return typeof body === 'object' && body !== null && body.type === 'TextualBody';
}

export function purposesOf(body: { purpose?: OneOrMany<Purpose> | undefined }): Purpose[] {
  return toArray(body.purpose);
}

export function textualBodies(annotation: AnnotationLike): TextualBody[] {
  return bodiesOf(annotation).filter(isTextualBody);
}

export function structuredBodies(annotation: AnnotationLike): StructuredBody[] {
  return bodiesOf(annotation).filter(isStructuredBody);
}

/** The comment: the first textual body that is not a tag, or `bodyValue`. */
export function commentOf(annotation: AnnotationLike): string {
  const body = textualBodies(annotation).find((b) => !purposesOf(b).includes('tagging'));
  return body?.value ?? annotation.bodyValue ?? '';
}

export function tagsOf(annotation: AnnotationLike): string[] {
  return textualBodies(annotation)
    .filter((b) => purposesOf(b).includes('tagging'))
    .map((b) => b.value);
}

export function motivationsOf(annotation: AnnotationLike): Motivation[] {
  return toArray(annotation.motivation as OneOrMany<Motivation> | undefined);
}

export function targetsOf(annotation: AnnotationLike): Target[] {
  return toArray(annotation.target as OneOrMany<Target> | undefined);
}

/** The IRI a target names: itself, its `source`, or its `id`. */
export function sourceOf(target: Target): string | undefined {
  if (typeof target === 'string') return target;
  if ('source' in target) {
    return typeof target.source === 'string' ? target.source : target.source.id;
  }
  if ('id' in target && typeof target.id === 'string') return target.id;
  return undefined;
}

/** The source IRIs of every target. */
export function sourcesOf(target: OneOrMany<Target>): string[] {
  return toArray(target).flatMap((t) => sourceOf(t) ?? []);
}

/** The annotated document: the first target source that is not an annotation of this server. */
export function documentOf(annotation: AnnotationLike): string | undefined {
  return targetsOf(annotation)
    .map(sourceOf)
    .find((s) => s !== undefined && !ANNOTATION_IRI.test(s));
}

/** The IRI of the annotation this one replies to, when a target is an annotation of this server. */
export function parentIri(annotation: AnnotationLike): string | undefined {
  return targetsOf(annotation)
    .map(sourceOf)
    .find((s) => s !== undefined && ANNOTATION_IRI.test(s));
}

/** The selectors of a target, or none for an IRI or a resource without selectors. */
export function selectorsOfTarget(target: Target): Selector[] {
  if (typeof target === 'string' || !('selector' in target)) return [];
  return toArray(target.selector);
}

/** A target's selectors and, depth first, every selector refining them. */
function refinedSelectorsOf(target: Target): Selector[] {
  const flat: Selector[] = [];
  const visit = (s: Selector): void => {
    flat.push(s);
    for (const inner of toArray(s.refinedBy)) visit(inner);
  };
  for (const s of selectorsOfTarget(target)) visit(s);
  return flat;
}

/** The quoted text of the first target that has a TextQuoteSelector. */
export function quoteOf(annotation: AnnotationLike): string | undefined {
  for (const target of targetsOf(annotation)) {
    for (const s of refinedSelectorsOf(target)) {
      if (s.type === 'TextQuoteSelector') return s.exact;
    }
  }
  return undefined;
}

/** The anchoring state the server stores for the first specific-resource target. */
export function anchoringOf(annotation: AnnotationLike): AnchoringState | undefined {
  for (const target of targetsOf(annotation)) {
    if (typeof target === 'object' && 'anchoring' in target && target.anchoring) {
      return target.anchoring.state;
    }
  }
  return undefined;
}

export interface CreatorView {
  /** Set when the creator is a user of this server. */
  userId?: string;
  name: string;
}

export function creatorOf(annotation: AnnotationLike): CreatorView {
  const creator = annotation.creator as string | Agent | undefined;
  if (creator === undefined) return { name: 'Unknown' };
  const id = typeof creator === 'string' ? creator : creator.id;
  const name =
    typeof creator === 'string'
      ? creator
      : (toArray(creator.name)[0] ?? creator.nickname ?? creator.id ?? 'Unknown');
  const userId = id ? USER_IRI.exec(id)?.[1] : undefined;
  return userId ? { userId, name } : { name };
}
