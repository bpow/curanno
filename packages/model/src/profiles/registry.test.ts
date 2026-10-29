import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { builtinProfiles, evidenceExcerptProfile } from './builtin.js';
import { ProfileRegistry, type BodyProfile } from './registry.js';

const compiler = new Ajv2020({ strict: true, allErrors: true });
const registry = new ProfileRegistry(compiler, builtinProfiles);

describe('ProfileRegistry', () => {
  it('lists built-in profiles and finds them by IRI', () => {
    expect(registry.list().map((p) => p.iri)).toEqual([evidenceExcerptProfile.iri]);
    expect(registry.get(evidenceExcerptProfile.iri)?.title).toBe('Evidence excerpt');
  });

  it('accepts a valid structured body', () => {
    expect(
      registry.validate({
        type: 'StructuredBody',
        profile: evidenceExcerptProfile.iri,
        value: { kind: 'case', identifiers: ['PMID:12345', 'HGNC:1100'], confidence: 'high' },
      }),
    ).toEqual({ ok: true, profile: evidenceExcerptProfile });
  });

  it('reports schema violations with paths into the value', () => {
    const result = registry.validate({
      type: 'StructuredBody',
      profile: evidenceExcerptProfile.iri,
      value: { kind: 'rumour', identifiers: ['not a curie'], extra: 1 },
    });
    expect(result).toMatchObject({ ok: false, reason: 'schema' });
    const paths = (result as { errors: { instancePath: string }[] }).errors.map(
      (e) => e.instancePath,
    );
    expect(paths).toEqual(
      expect.arrayContaining(['/value/kind', '/value/identifiers/0', '/value']),
    );
  });

  it('rejects an unregistered profile', () => {
    expect(
      registry.validate({
        type: 'StructuredBody',
        profile: 'https://scale.example/profiles/nope/1',
        value: {},
      }),
    ).toMatchObject({
      ok: false,
      reason: 'unknown-profile',
      profile: 'https://scale.example/profiles/nope/1',
    });
  });

  it('validates JSON textual bodies by purpose', () => {
    expect(
      registry.validate({
        type: 'TextualBody',
        format: 'application/json',
        purpose: 'classifying',
        value: '{"kind":"functional"}',
      }),
    ).toMatchObject({ ok: true });
    expect(
      registry.validate({
        type: 'TextualBody',
        format: 'application/json',
        purpose: 'classifying',
        value: '{',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid-json' });
  });

  it('leaves bodies no profile applies to alone', () => {
    expect(
      registry.validate({ type: 'TextualBody', value: 'plain comment', purpose: 'classifying' }),
    ).toBeUndefined();
    expect(registry.validate('https://example.org/body')).toBeUndefined();
  });

  it('refuses duplicate IRIs and purposes', () => {
    const other: BodyProfile = {
      iri: 'https://scale.example/profiles/other/1',
      title: 'Other',
      schema: { type: 'object' },
    };
    const r = new ProfileRegistry(compiler, [other]);
    expect(() => r.register(other)).toThrow(/already registered/);
    expect(() =>
      r.register({
        ...evidenceExcerptProfile,
        iri: 'https://scale.example/profiles/x/1',
        purposes: ['classifying'],
      }),
    ).not.toThrow();
    expect(() =>
      r.register({
        ...other,
        iri: 'https://scale.example/profiles/y/1',
        purposes: ['classifying'],
      }),
    ).toThrow(/purpose classifying/);
  });
});
