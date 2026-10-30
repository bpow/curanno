/**
 * The body profile registry on the client side (ADR 0016): the same
 * `ProfileRegistry` the server uses, compiled with Ajv from the schemas the
 * server lists, plus the field list an editor is built from.
 */
import type { BodyProfile as ApiBodyProfile } from '@scale/api-client';
import {
  addAnnotationFormats,
  ProfileRegistry,
  type BodyProfile,
  type JsonSchema,
} from '@scale/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function toModelProfile(profile: ApiBodyProfile): BodyProfile {
  return {
    iri: profile.iri,
    title: profile.title,
    ...(profile.description !== undefined ? { description: profile.description } : {}),
    schema: profile.schema,
  };
}

export function createRegistry(profiles: Iterable<BodyProfile>): ProfileRegistry {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  addAnnotationFormats(ajv);
  return new ProfileRegistry(ajv, profiles);
}

export type FieldKind = 'select' | 'text' | 'textarea' | 'number' | 'boolean' | 'string-list';

export interface SchemaField {
  name: string;
  title: string;
  description?: string;
  required: boolean;
  kind: FieldKind;
  options?: string[];
  pattern?: string;
}

interface PropertySchema {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  maxLength?: number;
  pattern?: string;
  items?: PropertySchema;
}

function kindOf(schema: PropertySchema): FieldKind {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum) return 'select';
  if (type === 'boolean') return 'boolean';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'array') return 'string-list';
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
    };
  });
}
