import type { JsonSchema } from '../annotation/schemas.js';
import { isStructuredBody, isTextualBody, purposesOf } from '../annotation/read.js';
import type { Body, Purpose } from '../annotation/types.js';

/**
 * Body profile registry (docs/body-profiles.md). A profile binds a JSON
 * Schema to a profile IRI, and optionally to body purposes, so that the
 * server and the sidebar validate structured bodies the same way.
 */
export interface BodyProfile {
  /** Identifies the profile; a StructuredBody names it in `profile`. Versioned by convention. */
  iri: string;
  title: string;
  description?: string;
  /** JSON Schema 2020-12 for the body's `value`. */
  schema: JsonSchema;
  /**
   * The purpose clients give a new body of this profile. Several profiles may
   * share one (ADR 0030).
   */
  defaultPurpose?: Purpose;
  /**
   * Purposes that select this profile for a TextualBody with
   * `format: application/json` that names no profile: the body is validated as
   * if it named this one. Each purpose selects at most one profile.
   */
  purposes?: Purpose[];
}

export interface ValidationError {
  instancePath: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; profile: BodyProfile }
  | { ok: false; reason: 'unknown-profile'; profile: string; errors: ValidationError[] }
  | { ok: false; reason: 'invalid-json'; profile: BodyProfile; errors: ValidationError[] }
  | { ok: false; reason: 'schema'; profile: BodyProfile; errors: ValidationError[] };

/** The part of Ajv this registry needs; any compiler with this shape works. */
export interface CompiledSchema {
  (data: unknown): boolean;
  errors?: { instancePath: string; message?: string }[] | null;
}

export interface SchemaCompiler {
  compile(schema: JsonSchema): CompiledSchema;
}

export class ProfileRegistry {
  private readonly byIri = new Map<string, { profile: BodyProfile; validate: CompiledSchema }>();
  private readonly byPurpose = new Map<string, BodyProfile>();

  constructor(
    private readonly compiler: SchemaCompiler,
    profiles: Iterable<BodyProfile> = [],
  ) {
    for (const p of profiles) this.register(p);
  }

  /** Register a profile. Throws when its IRI or one of its purposes is already taken. */
  register(profile: BodyProfile): void {
    if (this.byIri.has(profile.iri)) throw new Error(`profile already registered: ${profile.iri}`);
    for (const purpose of profile.purposes ?? []) {
      const taken = this.byPurpose.get(purpose);
      if (taken) throw new Error(`purpose ${purpose} already mapped to ${taken.iri}`);
    }
    const validate = this.compiler.compile(profile.schema);
    this.byIri.set(profile.iri, { profile, validate });
    for (const purpose of profile.purposes ?? []) this.byPurpose.set(purpose, profile);
  }

  get(iri: string): BodyProfile | undefined {
    return this.byIri.get(iri)?.profile;
  }

  list(): BodyProfile[] {
    return [...this.byIri.values()].map((e) => e.profile);
  }

  /** The profile a body should be validated against, if any. */
  resolve(body: Body): BodyProfile | string | undefined {
    if (isStructuredBody(body)) return this.get(body.profile) ?? body.profile;
    if (isTextualBody(body) && body.format === 'application/json') {
      for (const purpose of purposesOf(body)) {
        const profile = this.byPurpose.get(purpose);
        if (profile) return profile;
      }
    }
    return undefined;
  }

  /**
   * Validate one body. Bodies that no profile applies to are accepted. A
   * StructuredBody naming an unregistered profile is rejected.
   */
  validate(body: Body): ValidationResult | undefined {
    const resolved = this.resolve(body);
    if (resolved === undefined) return undefined;
    if (typeof resolved === 'string') {
      return {
        ok: false,
        reason: 'unknown-profile',
        profile: resolved,
        errors: [{ instancePath: '/profile', message: `unknown body profile ${resolved}` }],
      };
    }
    const entry = this.byIri.get(resolved.iri);
    if (!entry) throw new Error(`profile vanished: ${resolved.iri}`);
    let value: unknown;
    if (isStructuredBody(body)) {
      value = body.value;
    } else if (isTextualBody(body)) {
      try {
        value = JSON.parse(body.value) as unknown;
      } catch (err) {
        return {
          ok: false,
          reason: 'invalid-json',
          profile: resolved,
          errors: [{ instancePath: '/value', message: (err as Error).message }],
        };
      }
    } else {
      return undefined;
    }
    if (entry.validate(value)) return { ok: true, profile: resolved };
    return {
      ok: false,
      reason: 'schema',
      profile: resolved,
      errors: (entry.validate.errors ?? []).map((e) => ({
        instancePath: '/value' + e.instancePath,
        message: e.message ?? 'invalid',
      })),
    };
  }
}
