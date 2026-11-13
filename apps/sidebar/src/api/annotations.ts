/**
 * Building annotations from what the sidebar edits (a comment, tags and a
 * structured body), plus the per-annotation checks its cards make. Reading
 * annotations is in `@curanno/model`.
 */
import type { AclEntry, Annotation, AnnotationInput } from '@curanno/api-client';
import {
  commentOf,
  structuredBodies,
  tagsOf,
  targetsOf,
  type Agent,
  type AnchoringRepair,
  type Body,
  type JsonValue,
  type Motivation,
  type OneOrMany,
  type Selector,
  type Target,
} from '@curanno/model';

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
  /** Who made the body (ADR 0034): the model for an accepted suggestion; kept through edits. */
  creator?: OneOrMany<string | Agent>;
  created?: string;
}

/** What the editors work on. */
export interface AnnotationDraft {
  text: string;
  tags: string[];
  structured?: StructuredDraft;
  /** Grants to make once a new annotation is saved; editing an existing one leaves this unset. */
  acl?: AclEntry[];
}

export function emptyDraft(): AnnotationDraft {
  return { text: '', tags: [] };
}

export function draftOf(annotation: Annotation): AnnotationDraft {
  const structured = structuredBodies(annotation)[0];
  return {
    text: commentOf(annotation),
    tags: tagsOf(annotation),
    ...(structured
      ? {
          structured: {
            profile: structured.profile,
            value: structured.value,
            ...(structured.creator !== undefined ? { creator: structured.creator } : {}),
            ...(structured.created !== undefined ? { created: structured.created } : {}),
          },
        }
      : {}),
  };
}

function bodiesFrom(draft: AnnotationDraft, structuredPurpose?: Motivation): Body[] {
  const bodies: Body[] = [];
  const text = draft.text.trim();
  if (text) bodies.push({ type: 'TextualBody', value: text, purpose: 'commenting' });
  if (draft.structured) {
    const { profile, value, creator, created } = draft.structured;
    bodies.push({
      type: 'StructuredBody',
      profile,
      value,
      ...(structuredPurpose ? { purpose: structuredPurpose } : {}),
      ...(creator !== undefined ? { creator } : {}),
      ...(created !== undefined ? { created } : {}),
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

const SERVER_ASSIGNED = [
  '@context',
  'id',
  'creator',
  'created',
  'modified',
  'permissions',
  'public',
];

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
  const input = clientPropertiesOf(annotation);
  delete input['body'];
  delete input['bodyValue'];
  const bodies = bodiesFrom(draft, options.structuredPurpose);
  if (bodies.length) input['body'] = single(bodies);
  return input as AnnotationInput;
}

/** Everything in an annotation but what the server assigns. */
function clientPropertiesOf(annotation: Annotation): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(annotation)) {
    if (!SERVER_ASSIGNED.includes(key)) input[key] = value;
  }
  return input;
}

/**
 * The replacement that records a manual repair on the first
 * specific-resource target (ADR 0010). Everything else is sent back as it
 * was: the editor's draft holds only some of the bodies an annotation can
 * have, so it is not used here.
 */
export function repairInput(
  annotation: Annotation,
  selector: OneOrMany<Selector>,
): AnnotationInput {
  const input = clientPropertiesOf(annotation);
  const repair: AnchoringRepair = { selector, created: new Date().toISOString() };
  let done = false;
  const targets = targetsOf(annotation).map((target) => {
    if (done || typeof target !== 'object' || !('source' in target)) return target;
    done = true;
    return { ...target, anchoring: { state: 'repaired' as const, repair } };
  });
  return { ...input, target: single(targets) } as AnnotationInput;
}
