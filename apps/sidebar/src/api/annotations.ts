/**
 * Reading and building annotations in the shapes the W3C model allows
 * (one-or-many everywhere) for what the sidebar shows and edits: a comment,
 * tags, structured bodies, the quoted text and the anchoring state.
 */
import type { Annotation, AnnotationInput } from '@curanno/api-client';
import type {
  AnchoringRepair,
  AnchoringState,
  Body,
  JsonValue,
  Motivation,
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

function sourceOf(target: Target): string | undefined {
  if (typeof target === 'string') return target;
  if ('source' in target)
    return typeof target.source === 'string' ? target.source : target.source.id;
  if ('id' in target) return target.id;
  return undefined;
}

/** The IRI of the annotation this one replies to, when a target is an annotation of this server. */
export function parentIri(annotation: Annotation): string | undefined {
  for (const target of toArray(annotation.target as OneOrMany<Target>)) {
    const source = sourceOf(target);
    if (source && ANNOTATION_IRI.test(source)) return source;
  }
  return undefined;
}

export function bodiesOf(annotation: Annotation): Body[] {
  return toArray(annotation.body as OneOrMany<Body> | undefined);
}

function purposesOf(body: TextualBody | StructuredBody): string[] {
  return toArray(body.purpose);
}

export function textualBodies(annotation: Annotation): TextualBody[] {
  return bodiesOf(annotation).filter(
    (b): b is TextualBody => typeof b === 'object' && b.type === 'TextualBody',
  );
}

export function structuredBodies(annotation: Annotation): StructuredBody[] {
  return bodiesOf(annotation).filter(
    (b): b is StructuredBody => typeof b === 'object' && b.type === 'StructuredBody',
  );
}

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

export function targetsOf(annotation: Annotation): Target[] {
  return toArray(annotation.target as OneOrMany<Target>);
}

function selectorsOf(target: Target): Selector[] {
  if (typeof target !== 'object' || !('selector' in target)) return [];
  const flat: Selector[] = [];
  const visit = (s: Selector): void => {
    flat.push(s);
    for (const inner of toArray(s.refinedBy)) visit(inner);
  };
  for (const s of toArray(target.selector as OneOrMany<Selector> | undefined)) visit(s);
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

/** The anchoring state the server stores for the first specific-resource target. */
export function storedAnchoring(annotation: Annotation): AnchoringState | undefined {
  for (const target of targetsOf(annotation)) {
    if (typeof target === 'object' && 'anchoring' in target && target.anchoring) {
      return target.anchoring.state;
    }
  }
  return undefined;
}

export function creatorName(annotation: Annotation): string {
  const creator = annotation.creator;
  if (typeof creator === 'string') return creator;
  const name = toArray(creator?.name)[0];
  return name ?? creator?.nickname ?? creator?.id ?? 'Unknown';
}

/** The user id behind `creator`, when it is a user of this server. */
export function creatorUserId(annotation: Annotation): string | undefined {
  const id = typeof annotation.creator === 'string' ? annotation.creator : annotation.creator?.id;
  return id ? USER_IRI.exec(id)?.[1] : undefined;
}

export function can(annotation: Annotation, permission: 'read' | 'update' | 'delete' | 'share') {
  return annotation.permissions?.includes(permission) ?? false;
}

export function isEdited(annotation: Annotation): boolean {
  return (
    annotation.modified !== undefined &&
    annotation.created !== undefined &&
    annotation.modified !== annotation.created
  );
}

// ---------------------------------------------------------------------------
// Building input

export interface StructuredDraft {
  profile: string;
  value: JsonValue;
}

/** What the editors work on. */
export interface AnnotationDraft {
  text: string;
  tags: string[];
  structured?: StructuredDraft;
}

export function emptyDraft(): AnnotationDraft {
  return { text: '', tags: [] };
}

export function draftOf(annotation: Annotation): AnnotationDraft {
  const structured = structuredBodies(annotation)[0];
  return {
    text: commentOf(annotation),
    tags: tagsOf(annotation),
    ...(structured ? { structured: { profile: structured.profile, value: structured.value } } : {}),
  };
}

function bodiesFrom(draft: AnnotationDraft, structuredPurpose?: Motivation): Body[] {
  const bodies: Body[] = [];
  const text = draft.text.trim();
  if (text) bodies.push({ type: 'TextualBody', value: text, purpose: 'commenting' });
  if (draft.structured) {
    bodies.push({
      type: 'StructuredBody',
      profile: draft.structured.profile,
      value: draft.structured.value,
      ...(structuredPurpose ? { purpose: structuredPurpose } : {}),
    });
  }
  for (const tag of draft.tags) {
    bodies.push({ type: 'TextualBody', value: tag, purpose: 'tagging' });
  }
  return bodies;
}

function motivationFor(draft: AnnotationDraft, reply: boolean): Motivation {
  if (reply) return 'replying';
  if (draft.text.trim()) return 'commenting';
  if (draft.structured) return 'classifying';
  if (draft.tags.length) return 'tagging';
  return 'highlighting';
}

function single<T>(items: T[]): T | T[] {
  return items.length === 1 ? (items[0] as T) : items;
}

export interface BuildOptions {
  /** The purpose a structured body carries, usually the profile's first purpose. */
  structuredPurpose?: Motivation;
  reply?: boolean;
}

/** A new annotation on `target` from the editors' draft. */
export function buildInput(
  draft: AnnotationDraft,
  target: OneOrMany<Target>,
  options: BuildOptions = {},
): AnnotationInput {
  const bodies = bodiesFrom(draft, options.structuredPurpose);
  return {
    type: 'Annotation',
    motivation: motivationFor(draft, options.reply ?? false),
    ...(bodies.length ? { body: single(bodies) } : {}),
    target,
  } as AnnotationInput;
}

const SERVER_ASSIGNED = ['@context', 'id', 'creator', 'created', 'modified', 'permissions'];

/**
 * The replacement for an existing annotation with its bodies rebuilt from
 * the draft. Targets, motivation and extension properties are kept, so the
 * original selectors stay as they are (ADR 0010).
 */
export function rebuildInput(
  annotation: Annotation,
  draft: AnnotationDraft,
  options: BuildOptions = {},
): AnnotationInput {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(annotation)) {
    if (!SERVER_ASSIGNED.includes(key)) input[key] = value;
  }
  delete input['body'];
  delete input['bodyValue'];
  const bodies = bodiesFrom(draft, options.structuredPurpose);
  if (bodies.length) input['body'] = single(bodies);
  return input as AnnotationInput;
}

/** The replacement that records a manual repair on the first specific-resource target (ADR 0010). */
export function repairInput(
  annotation: Annotation,
  selector: OneOrMany<Selector>,
): AnnotationInput {
  const structuredPurpose = structuredPurposeOf(annotation);
  const input = rebuildInput(annotation, draftOf(annotation), {
    ...(structuredPurpose ? { structuredPurpose } : {}),
  });
  const repair: AnchoringRepair = { selector, created: new Date().toISOString() };
  let done = false;
  const targets = targetsOf(annotation).map((target) => {
    if (done || typeof target !== 'object' || !('source' in target)) return target;
    done = true;
    return { ...target, anchoring: { state: 'repaired' as const, repair } };
  });
  return { ...input, target: single(targets) } as AnnotationInput;
}

export function structuredPurposeOf(annotation: Annotation): Motivation | undefined {
  return toArray(structuredBodies(annotation)[0]?.purpose)[0];
}
