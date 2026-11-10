/**
 * The body profile registry on the client side (ADR 0016): the same
 * `ProfileRegistry` the server uses, compiled with Ajv from the schemas the
 * server lists, plus the field list an editor is built from.
 */
import type { BodyProfile as ApiBodyProfile } from '@curanno/api-client';
import {
  addAnnotationFormats,
  ProfileRegistry,
  type BodyProfile,
  type JsonSchema,
} from '@curanno/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function toModelProfile(profile: ApiBodyProfile): BodyProfile {
  return {
    iri: profile.iri,
    title: profile.title,
    ...(profile.description !== undefined ? { description: profile.description } : {}),
    ...(profile.defaultPurpose !== undefined ? { defaultPurpose: profile.defaultPurpose } : {}),
    schema: profile.schema,
  };
}

export function createRegistry(profiles: Iterable<BodyProfile>): ProfileRegistry {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  addAnnotationFormats(ajv);
  return new ProfileRegistry(ajv, profiles);
}

export type FieldKind =
  'select' | 'text' | 'textarea' | 'number' | 'boolean' | 'string-list' | 'object-list';

export interface SchemaField {
  name: string;
  title: string;
  description?: string;
  required: boolean;
  kind: FieldKind;
  options?: string[];
  pattern?: string;
  /** For an object list: the fields of each item and the item's name. */
  fields?: SchemaField[];
  itemTitle?: string;
}

interface PropertySchema {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  maxLength?: number;
  pattern?: string;
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

function kindOf(schema: PropertySchema): FieldKind {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum) return 'select';
  if (type === 'boolean') return 'boolean';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'array') {
    const items = schema.items;
    return items?.type === 'object' || items?.properties ? 'object-list' : 'string-list';
  }
  if (schema.maxLength === undefined || schema.maxLength > 200) return 'textarea';
  return 'text';
}

/** The editable fields of an object schema, in declaration order. */
export function fieldsOf(schema: JsonSchema): SchemaField[] {
  const properties = (schema['properties'] ?? {}) as Record<string, PropertySchema>;
  const required = new Set((schema['required'] as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, property]) => {
    const kind = kindOf(property);
    const pattern = kind === 'string-list' ? property.items?.pattern : property.pattern;
    return {
      name,
      title: property.title ?? name,
      ...(property.description !== undefined ? { description: property.description } : {}),
      required: required.has(name),
      kind,
      ...(property.enum ? { options: property.enum.map(String) } : {}),
      ...(pattern !== undefined ? { pattern } : {}),
      ...(kind === 'object-list' && property.items
        ? {
            fields: fieldsOf(property.items as JsonSchema),
            itemTitle: property.items.title ?? 'item',
          }
        : {}),
    };
  });
}
