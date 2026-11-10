import { Ajv2020 } from 'ajv/dist/2020.js';
import type { JsonValue } from '../annotation/types.js';
import { describe, expect, it } from 'vitest';
import { builtinProfiles, caseIndividualProfile, evidenceExcerptProfile } from './builtin.js';
import { ProfileRegistry, type BodyProfile } from './registry.js';

const compiler = new Ajv2020({ strict: true, allErrors: true });
const registry = new ProfileRegistry(compiler, builtinProfiles);

describe('ProfileRegistry', () => {
  it('lists built-in profiles and finds them by IRI', () => {
    expect(registry.list().map((p) => p.iri)).toEqual([
      evidenceExcerptProfile.iri,
      caseIndividualProfile.iri,
    ]);
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
        profile: 'https://curanno.example/profiles/nope/1',
        value: {},
      }),
    ).toMatchObject({
      ok: false,
      reason: 'unknown-profile',
      profile: 'https://curanno.example/profiles/nope/1',
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
      iri: 'https://curanno.example/profiles/other/1',
      title: 'Other',
      schema: { type: 'object' },
    };
    const r = new ProfileRegistry(compiler, [other]);
    expect(() => r.register(other)).toThrow(/already registered/);
    expect(() =>
      r.register({
        ...evidenceExcerptProfile,
        iri: 'https://curanno.example/profiles/x/1',
        purposes: ['classifying'],
      }),
    ).not.toThrow();
    expect(() =>
      r.register({
        ...other,
        iri: 'https://curanno.example/profiles/y/1',
        purposes: ['classifying'],
      }),
    ).toThrow(/purpose classifying/);
  });
});

describe('case-individual profile', () => {
  const validate = (value: JsonValue) =>
    registry.validate({ type: 'StructuredBody', profile: caseIndividualProfile.iri, value });

  it('accepts a case with several variants', () => {
    expect(
      validate({
        case: 'Patient 3',
        diseaseAssertion: 'Hypertrophic cardiomyopathy',
        casePresentingHpos: ['HP:0001639'],
        genotypingMethod: 'Exome sequencing',
        variants: [
          { geneName: 'MYH7', variant: 'NM_000257.4:c.1208G>A', clinVarId: '123', caid: 'CA1' },
          { geneName: 'MYBPC3', variant: 'c.1504C>T' },
        ],
      }),
    ).toMatchObject({ ok: true });
  });

  it('requires the case and at least one identified variant', () => {
    const paths = (value: JsonValue) =>
      (validate(value) as { errors: { instancePath: string }[] }).errors.map((e) => e.instancePath);
    expect(paths({ variants: [] })).toEqual(expect.arrayContaining(['/value', '/value/variants']));
    expect(paths({ case: 'P1', variants: [{ geneName: 'MYH7' }] })).toEqual(['/value/variants/0']);
  });

  it('checks identifier formats and empty fields', () => {
    const result = validate({
      case: '',
      casePresentingHpos: ['HP:1639'],
      variants: [{ variant: 'c.1A>G', clinVarId: 'VCV1', caid: '123', typo: 1 }],
    });
    const paths = (result as { errors: { instancePath: string }[] }).errors.map(
      (e) => e.instancePath,
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        '/value/case',
        '/value/casePresentingHpos/0',
        '/value/variants/0/clinVarId',
        '/value/variants/0/caid',
        '/value/variants/0',
      ]),
    );
  });
});
