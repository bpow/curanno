import { describe, expect, it } from 'vitest';
import { deriveDocumentUris, rankDocumentUris, resolveLink } from './identity.js';

describe('deriveDocumentUris', () => {
  it('collects every identifier a page reports, normalized, in precedence order', () => {
    const uris = deriveDocumentUris({
      url: 'http://journal.example/article/42?utm_campaign=x',
      canonical: '/article/42',
      ogUrl: 'https://journal.example/article/42',
      shortlink: 'https://jrnl.ex/a42',
      doi: '10.1000/J.42',
      dcIdentifiers: ['10.1000/j.42', 'art-42'],
      dcRelationIsPartOf: 'urn:issn:0000-0001',
      pdfUrl: 'https://journal.example/article/42.pdf',
    });
    expect(uris).toEqual([
      {
        uri: 'http://journal.example/article/42?utm_campaign=x',
        normalized: 'https://journal.example/article/42',
        relation: 'self',
      },
      { uri: '10.1000/J.42', normalized: 'doi:10.1000/j.42', relation: 'doi' },
      {
        uri: '10.1000/j.42',
        normalized: 'urn:x-dc:urn%3Aissn%3A0000-0001/10.1000%2Fj.42',
        relation: 'dc_identifier',
      },
      {
        uri: 'art-42',
        normalized: 'urn:x-dc:urn%3Aissn%3A0000-0001/art-42',
        relation: 'dc_identifier',
      },
      { uri: 'https://jrnl.ex/a42', normalized: 'https://jrnl.ex/a42', relation: 'shortlink' },
      {
        uri: 'https://journal.example/article/42.pdf',
        normalized: 'https://journal.example/article/42.pdf',
        relation: 'pdf_url',
      },
    ]);
  });

  it('identifies a PDF by its fingerprint first', () => {
    const uris = deriveDocumentUris({
      url: 'https://files.example/paper.pdf',
      pdfFingerprint: 'ABC123',
    });
    expect(uris.map((u) => [u.relation, u.normalized])).toEqual([
      ['self', 'https://files.example/paper.pdf'],
      ['pdf_fingerprint', 'urn:x-pdf:abc123'],
    ]);
  });

  it('ignores canonical links to a site root, non-http links and unparseable links', () => {
    const uris = deriveDocumentUris({
      url: 'https://blog.example/post/1',
      canonical: 'https://blog.example/',
      ogUrl: 'ftp://blog.example/post/1',
      shortlink: 'http://[bad',
    });
    expect(uris.map((u) => u.relation)).toEqual(['self']);
  });

  it('keeps the first relation when two sources agree', () => {
    const uris = deriveDocumentUris({
      url: 'https://a.example/p',
      canonical: 'https://a.example/p',
      ogUrl: 'https://a.example/p?utm_source=feed',
    });
    expect(uris).toHaveLength(1);
    expect(uris[0]?.relation).toBe('self');
  });

  it('accepts a page whose own URL is not identifiable only through its other identifiers', () => {
    const uris = deriveDocumentUris({ url: 'about:blank', doi: '10.1000/x' });
    expect(uris.map((u) => u.relation)).toEqual(['doi']);
  });
});

describe('resolveLink', () => {
  it('resolves relative links against the page', () => {
    expect(resolveLink('../b?x=1#f', 'https://h.example/a/c/')).toBe('https://h.example/a/b?x=1');
  });
  it('returns null for empty input', () => {
    expect(resolveLink(undefined, 'https://h.example/')).toBeNull();
    expect(resolveLink(' ', 'https://h.example/')).toBeNull();
  });
});

describe('rankDocumentUris', () => {
  it('keeps the most trusted relation for a shared normalized URI, in trust order', () => {
    const ranked = rankDocumentUris([
      { uri: 'https://a.test/s', normalized: 'https://a.test/s', relation: 'shortlink' },
      { uri: 'https://a.test/x', normalized: 'https://a.test/x', relation: 'og_url' },
      { uri: 'https://a.test/x/', normalized: 'https://a.test/x', relation: 'canonical' },
    ]);
    expect(ranked.map((u) => u.relation)).toEqual(['canonical', 'shortlink']);
  });
});
