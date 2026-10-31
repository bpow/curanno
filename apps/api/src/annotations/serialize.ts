/**
 * Builds the JSON-LD representation of a stored annotation: the W3C
 * properties, this platform's extension context, the caller's permissions
 * and whatever extension properties were stored with it.
 */
import {
  extensionContextIri,
  WEB_ANNOTATION_CONTEXT,
  type AnchoringRepair,
  type AnchoringState,
  type Annotation,
  type Body,
  type Permission,
  type Selector,
  type Target,
} from '@curanno/model';
import { TARGET_SHAPE, type TargetShape } from './input.js';

export interface StoredTarget {
  position: number;
  source: string;
  selectors: Selector | Selector[] | null;
  anchoring_state: AnchoringState;
  repair: AnchoringRepair | null;
  data: Record<string, unknown>;
}

export interface StoredBody {
  position: number;
  body: Body;
}

export interface AnnotationRecord {
  id: string;
  document_id: string | null;
  parent_id: string | null;
  created_by: string;
  creator_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
  motivation: string[];
  data: Record<string, unknown>;
  deleted_at: Date | string | null;
  bodies: StoredBody[];
  targets: StoredTarget[];
  permissions: Permission[];
  /** Whether the `public` principal may read the annotation. */
  public: boolean;
}

/** The W3C context, then this deployment's extension context (served at `/x/context.jsonld`). */
export function annotationContext(publicUrl: string): string[] {
  return [WEB_ANNOTATION_CONTEXT, extensionContextIri(publicUrl)];
}

export function annotationIri(publicUrl: string, id: string): string {
  return `${publicUrl}/annotations/${id}`;
}

export function userIri(publicUrl: string, id: string): string {
  return `${publicUrl}/x/users/${id}`;
}

/** The annotation id an IRI of this server names, if it is one. */
export function annotationIdFromIri(publicUrl: string, iri: string): string | undefined {
  const prefix = `${publicUrl}/annotations/`;
  if (!iri.startsWith(prefix)) return undefined;
  const id = iri.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : undefined;
}

export function etagOf(record: { version: number }): string {
  return `"${record.version}"`;
}

export function isoDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function single<T>(items: T[]): T | T[] | undefined {
  if (items.length === 0) return undefined;
  return items.length === 1 ? items[0] : items;
}

export function toAnnotation(record: AnnotationRecord, publicUrl: string): Annotation {
  const { type, ...data } = record.data;
  const motivation = single(record.motivation);
  const body = single(
    [...record.bodies].sort((a, b) => a.position - b.position).map((b) => b.body),
  );
  const target = single(
    [...record.targets].sort((a, b) => a.position - b.position).map(toTarget),
  ) as Target | Target[];
  return {
    '@context': annotationContext(publicUrl),
    id: annotationIri(publicUrl, record.id),
    type: (type as Annotation['type'] | undefined) ?? 'Annotation',
    creator: {
      id: userIri(publicUrl, record.created_by),
      type: 'Person',
      ...(record.creator_name ? { name: record.creator_name } : {}),
    },
    created: isoDate(record.created_at),
    modified: isoDate(record.updated_at),
    ...(motivation !== undefined ? { motivation } : {}),
    ...(body !== undefined ? { body } : {}),
    target,
    ...data,
    permissions: record.permissions,
    public: record.public,
  };
}

function toTarget(target: StoredTarget): Target {
  const { [TARGET_SHAPE]: shape, ...rest } = target.data;
  switch (shape as TargetShape | undefined) {
    case 'iri':
      return target.source;
    case 'external':
      return { id: target.source, ...rest };
    default: {
      const { source, ...props } = rest;
      return {
        type: 'SpecificResource',
        source: (source as Target | undefined) ?? target.source,
        ...(target.selectors !== null ? { selector: target.selectors } : {}),
        ...props,
        anchoring: {
          state: target.anchoring_state,
          ...(target.repair ? { repair: target.repair } : {}),
        },
      } as Target;
    }
  }
}
