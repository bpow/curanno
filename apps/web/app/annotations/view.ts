/**
 * Reading annotations in the shapes the W3C model allows (one-or-many
 * everywhere) for what the site shows: creator, document, quote, bodies,
 * motivations and anchoring state.
 */
import type { Annotation } from '@curanno/api-client';
import type {
  AnchoringState,
  Body,
  OneOrMany,
  Selector,
  StructuredBody,
  Target,
  TextualBody,
} from '@curanno/model';

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

export interface CreatorView {
  userId?: string;
  name: string;
}

export function creatorOf(annotation: Annotation): CreatorView {
  const creator = annotation.creator;
  if (creator === undefined) return { name: 'unknown' };
  if (typeof creator === 'string') {
    const userId = USER_IRI.exec(creator)?.[1];
    return userId ? { userId, name: creator } : { name: creator };
  }
  const name = toArray(creator.name)[0] ?? creator.nickname ?? creator.id ?? 'unknown';
  const userId = creator.id ? USER_IRI.exec(creator.id)?.[1] : undefined;
  return userId ? { userId, name } : { name };
}

export function bodiesOf(annotation: Annotation): Body[] {
  return toArray(annotation.body as OneOrMany<Body> | undefined);
}

const isTextual = (b: Body): b is TextualBody => typeof b === 'object' && b.type === 'TextualBody';
const isStructured = (b: Body): b is StructuredBody =>
  typeof b === 'object' && b.type === 'StructuredBody';

export function textualBodies(annotation: Annotation): TextualBody[] {
  return bodiesOf(annotation).filter(isTextual);
}

export function structuredBodies(annotation: Annotation): StructuredBody[] {
  return bodiesOf(annotation).filter(isStructured);
}

const purposesOf = (body: TextualBody | StructuredBody): string[] => toArray(body.purpose);

/** The comment: the first textual body that is not a tag, or `bodyValue`. */
export function commentOf(annotation: Annotation): string {
  const body = textualBodies(annotation).find((b) => !purposesOf(b).includes('tagging'));
  return body?.value ?? annotation.bodyValue ?? '';
}

export function tagsOf(annotation: Annotation): string[] {
  return textualBodies(annotation)
    .filter((b) => purposesOf(b).includes('tagging'))
    .map((b) => b.value);
}

export function motivationsOf(annotation: Annotation): string[] {
  return toArray(annotation.motivation);
}

export function targetsOf(annotation: Annotation): Target[] {
  return toArray(annotation.target as OneOrMany<Target>);
}

export function sourceOf(target: Target): string | undefined {
  if (typeof target === 'string') return target;
  if ('source' in target) {
    return typeof target.source === 'string' ? target.source : target.source.id;
  }
  if ('id' in target && typeof target.id === 'string') return target.id;
  return undefined;
}

/** The annotated document: the first target source that is not one of our annotations. */
export function documentOf(annotation: Annotation): string | undefined {
  return targetsOf(annotation)
    .map(sourceOf)
    .find((s) => s !== undefined && !ANNOTATION_IRI.test(s));
}

/** The annotation this one replies to, when a target is an annotation of this server. */
export function parentOf(annotation: Annotation): string | undefined {
  for (const target of targetsOf(annotation)) {
    const source = sourceOf(target);
    if (source && ANNOTATION_IRI.test(source)) return annotationUuid(source);
  }
  return undefined;
}

function selectorsOf(target: Target): Selector[] {
  if (typeof target !== 'object' || !('selector' in target)) return [];
  const flat: Selector[] = [];
  const visit = (s: Selector): void => {
    flat.push(s);
    for (const inner of toArray(s.refinedBy)) visit(inner);
  };
  for (const s of toArray(target.selector)) visit(s);
  return flat;
}

/** The quoted text of the first target that has a TextQuoteSelector. */
export function quoteOf(annotation: Annotation): string | undefined {
  for (const target of targetsOf(annotation)) {
    for (const s of selectorsOf(target)) {
      if (s.type === 'TextQuoteSelector') return s.exact;
    }
  }
  return undefined;
}

export function anchoringOf(annotation: Annotation): AnchoringState | undefined {
  for (const target of targetsOf(annotation)) {
    if (typeof target === 'object' && 'anchoring' in target && target.anchoring) {
      return target.anchoring.state;
    }
  }
  return undefined;
}

export function excerpt(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type BodyView =
  | { kind: 'iri'; iri: string }
  | { kind: 'textual'; value: string; purposes: string[] }
  | { kind: 'structured'; profile: string; json: string }
  | { kind: 'other'; json: string };

/** A body in one of the shapes the detail page renders. */
export function viewBody(body: Body): BodyView {
  if (typeof body === 'string') return { kind: 'iri', iri: body };
  if (isTextual(body)) {
    return { kind: 'textual', value: body.value, purposes: toArray(body.purpose) };
  }
  if (isStructured(body)) {
    return { kind: 'structured', profile: body.profile, json: JSON.stringify(body.value, null, 2) };
  }
  return { kind: 'other', json: JSON.stringify(body, null, 2) };
}
