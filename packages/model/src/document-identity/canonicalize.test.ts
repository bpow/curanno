import { describe, expect, it } from 'vitest';
import {
  canonicalizeDoi,
  canonicalizeUri,
  dcIdentifierUri,
  pdfFingerprintUri,
} from './canonicalize.js';

describe('canonicalizeUri', () => {
  it.each([
    ['https://Example.ORG/Path', 'https://example.org/Path'],
    ['http://example.org/path', 'https://example.org/path'],
    ['https://example.org:443/path', 'https://example.org/path'],
    ['https://example.org', 'https://example.org/'],
    ['https://example.org/a/./b/../c', 'https://example.org/a/c'],
    ['https://example.org/path#section', 'https://example.org/path'],
    ['https://example.org/path?', 'https://example.org/path'],
    ['https://example.org/p?b=2&a=1', 'https://example.org/p?a=1&b=2'],
    ['https://example.org/p?utm_source=x&id=7&fbclid=y', 'https://example.org/p?id=7'],
    ['https://example.org/p?utm_source=x', 'https://example.org/p'],
    [
      'https://bucket.example/r.pdf?X-Amz-Security-Token=abc&id=7',
      'https://bucket.example/r.pdf?id=7',
    ],
    ['https://drive.example/file/d/1?resourcekey=0-xyz', 'https://drive.example/file/d/1'],
    ['https://example.org/%7Euser/%7e/%2fa', 'https://example.org/~user/~/%2Fa'],
    ['https://user:pw@example.org/p', 'https://example.org/p'],
    ['https://münchen.example/straße', 'https://xn--mnchen-3ya.example/stra%C3%9Fe'],
    ['  https://example.org/p  ', 'https://example.org/p'],
    ['https://example.org/p?a=1&a=0', 'https://example.org/p?a=0&a=1'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalizeUri(input)).toBe(expected);
  });

  it('keeps trailing slashes and distinct paths distinct', () => {
    expect(canonicalizeUri('https://example.org/a/')).not.toBe(
      canonicalizeUri('https://example.org/a'),
    );
  });

  it('returns null for things that do not identify a document', () => {
    expect(canonicalizeUri('')).toBeNull();
    expect(canonicalizeUri('not a url')).toBeNull();
    expect(canonicalizeUri('javascript:alert(1)')).toBeNull();
    expect(canonicalizeUri('mailto:a@example.org')).toBeNull();
    expect(canonicalizeUri('https://')).toBeNull();
  });

  it('handles DOIs and URNs', () => {
    expect(canonicalizeUri('doi:10.1000/ABC.Def')).toBe('doi:10.1000/abc.def');
    expect(canonicalizeUri('urn:X-PDF:ABCDEF0123')).toBe('urn:x-pdf:abcdef0123');
    expect(canonicalizeUri('urn:isbn:0451450523')).toBe('urn:isbn:0451450523');
    expect(canonicalizeUri('urn:bad')).toBeNull();
  });
});

describe('canonicalizeDoi', () => {
  it('accepts bare names, doi: prefixes and doi.org URLs', () => {
    expect(canonicalizeDoi('10.1093/NAR/gkab1049')).toBe('doi:10.1093/nar/gkab1049');
    expect(canonicalizeDoi('doi:10.1093/nar/gkab1049')).toBe('doi:10.1093/nar/gkab1049');
    expect(canonicalizeDoi('https://doi.org/10.1093/nar/gkab1049')).toBe(
      'doi:10.1093/nar/gkab1049',
    );
    expect(canonicalizeDoi('http://dx.doi.org/10.1093%2Fnar%2Fgkab1049')).toBe(
      'doi:10.1093/nar/gkab1049',
    );
  });
  it('rejects strings that are not DOIs', () => {
    expect(canonicalizeDoi('10.1/x')).toBeNull();
    expect(canonicalizeDoi('PMID:123')).toBeNull();
  });
});

describe('identifier URIs', () => {
  it('lower-cases PDF fingerprints', () => {
    expect(pdfFingerprintUri(' 3A1B ')).toBe('urn:x-pdf:3a1b');
  });
  it('scopes dc.identifier to dc.relation.ispartof', () => {
    expect(dcIdentifierUri('vol1/art2', 'urn:issn:1234-5678')).toBe(
      'urn:x-dc:urn%3Aissn%3A1234-5678/vol1%2Fart2',
    );
  });
  it('uses the identifier directly when it is a DOI or an absolute URI', () => {
    expect(dcIdentifierUri('10.1000/xyz')).toBe('doi:10.1000/xyz');
    expect(dcIdentifierUri('http://example.org/doc')).toBe('https://example.org/doc');
    expect(dcIdentifierUri('local-id-7')).toBe('urn:x-dc:local-id-7');
    expect(dcIdentifierUri('  ')).toBeNull();
  });
});
