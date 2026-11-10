/**
 * The body profile registry as the server sees it (docs/body-profiles.md):
 * built-in profiles from packages/model plus rows administrators registered,
 * compiled on the strict Ajv instance. Built-ins are upserted into
 * `body_profiles` at start so that the API lists one registry.
 */
import type { Kysely } from 'kysely';
import type { components } from '@curanno/api-client';
import {
  ProfileRegistry,
  builtinProfiles,
  type Body,
  type BodyProfile,
  type SchemaCompiler,
} from '@curanno/model';
import type { Database } from '../db/index.js';
import { isoDate } from '../annotations/serialize.js';
import { badRequest, unprocessable, type ValidationIssue } from '../problems.js';

export type BodyProfileJson = components['schemas']['BodyProfile'];

const builtinByIri = new Map(builtinProfiles.map((p) => [p.iri, p]));

export class ProfileService {
  private cached: { registry: ProfileRegistry; loadedAt: number } | undefined;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly compiler: SchemaCompiler,
    /** How long a loaded registry is reused before rows registered elsewhere are picked up. */
    private readonly ttlMs = 30_000,
  ) {}

  async seedBuiltins(): Promise<void> {
    for (const profile of builtinProfiles) {
      await this.db
        .insertInto('body_profiles')
        .values({
          iri: profile.iri,
          title: profile.title,
          description: profile.description ?? null,
          default_purpose: profile.defaultPurpose ?? null,
          schema: JSON.stringify(profile.schema),
          builtin: true,
          enabled: true,
        })
        .onConflict((oc) =>
          oc.column('iri').doUpdateSet({
            title: profile.title,
            description: profile.description ?? null,
            default_purpose: profile.defaultPurpose ?? null,
            schema: JSON.stringify(profile.schema),
            builtin: true,
            updated_at: new Date(),
          }),
        )
        .execute();
    }
    this.invalidate();
  }

  invalidate(): void {
    this.cached = undefined;
  }

  async registry(): Promise<ProfileRegistry> {
    if (this.cached && Date.now() - this.cached.loadedAt < this.ttlMs) return this.cached.registry;
    const rows = await this.db
      .selectFrom('body_profiles')
      .select(['iri', 'title', 'description', 'default_purpose', 'schema', 'builtin'])
      .where('enabled', '=', true)
      .execute();
    const profiles: BodyProfile[] = rows.map((row) => {
      const builtin = row.builtin ? builtinByIri.get(row.iri) : undefined;
      if (builtin) return builtin;
      return {
        iri: row.iri,
        title: row.title,
        ...(row.description !== null ? { description: row.description } : {}),
        ...(row.default_purpose !== null ? { defaultPurpose: row.default_purpose } : {}),
        schema: row.schema,
      };
    });
    const registry = new ProfileRegistry(this.compiler, profiles);
    this.cached = { registry, loadedAt: Date.now() };
    return registry;
  }

  /**
   * Validate every body of an annotation, the items of a `Choice` included;
   * throws 422 naming each failing body.
   */
  async validateBodies(bodies: Body[]): Promise<void> {
    const registry = await this.registry();
    const errors: ValidationIssue[] = [];
    const check = (body: Body, path: string): void => {
      if (typeof body === 'object' && 'items' in body) {
        body.items.forEach((item, j) => check(item, `${path}/items/${j}`));
        return;
      }
      const result = registry.validate(body);
      if (result && !result.ok) {
        for (const e of result.errors) {
          errors.push({ instancePath: `${path}${e.instancePath}`, message: e.message });
        }
      }
    };
    bodies.forEach((body, i) => check(body, `/body/${i}`));
    if (errors.length > 0) throw unprocessable('a body does not satisfy its profile', errors);
  }

  async list(): Promise<BodyProfileJson[]> {
    const rows = await this.db.selectFrom('body_profiles').selectAll().orderBy('iri').execute();
    return rows.map(toJson);
  }

  async get(iri: string): Promise<BodyProfileJson | undefined> {
    const row = await this.db
      .selectFrom('body_profiles')
      .selectAll()
      .where('iri', '=', iri)
      .executeTakeFirst();
    return row && toJson(row);
  }

  /** Register or update a profile; returns whether it was created. Throws when the IRI is built in or the schema does not compile. */
  async put(
    iri: string,
    input: components['schemas']['BodyProfileInput'],
    actorId: string,
  ): Promise<{ profile: BodyProfileJson; created: boolean }> {
    try {
      this.compiler.compile(input.schema);
    } catch (err) {
      throw badRequest(`schema does not compile: ${(err as Error).message}`);
    }
    const existing = await this.db
      .selectFrom('body_profiles')
      .select('builtin')
      .where('iri', '=', iri)
      .executeTakeFirst();
    if (existing?.builtin) throw new ConflictError('built-in profiles cannot be changed');
    const values = {
      title: input.title,
      description: input.description ?? null,
      default_purpose: input.defaultPurpose ?? null,
      schema: JSON.stringify(input.schema),
      enabled: input.enabled ?? true,
    };
    const row = existing
      ? await this.db
          .updateTable('body_profiles')
          .set({ ...values, updated_at: new Date() })
          .where('iri', '=', iri)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await this.db
          .insertInto('body_profiles')
          .values({ iri, ...values, created_by: actorId })
          .returningAll()
          .executeTakeFirstOrThrow();
    this.invalidate();
    return { profile: toJson(row), created: existing === undefined };
  }

  /** Returns false when there is no such profile. */
  async delete(iri: string): Promise<boolean> {
    const existing = await this.db
      .selectFrom('body_profiles')
      .select('builtin')
      .where('iri', '=', iri)
      .executeTakeFirst();
    if (!existing) return false;
    if (existing.builtin) throw new ConflictError('built-in profiles cannot be removed');
    await this.db.deleteFrom('body_profiles').where('iri', '=', iri).execute();
    this.invalidate();
    return true;
  }
}

export class ConflictError extends Error {}

interface ProfileRow {
  iri: string;
  title: string;
  description: string | null;
  default_purpose: string | null;
  schema: unknown;
  builtin: boolean;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

function toJson(row: ProfileRow): BodyProfileJson {
  return {
    iri: row.iri,
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.default_purpose !== null ? { defaultPurpose: row.default_purpose } : {}),
    schema: row.schema as Record<string, never>,
    builtin: row.builtin,
    enabled: row.enabled,
    created: isoDate(row.created_at),
    modified: isoDate(row.updated_at),
  };
}
