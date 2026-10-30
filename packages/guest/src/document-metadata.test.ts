// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectDocument, collectPageMetadata } from './document-metadata.js';

describe('collectDocument', () => {
  it('reports every identifier the page exposes, as found', () => {
    document.head.innerHTML = `
      <title> A paper </title>
      <link rel="canonical" href="/articles/42?utm_source=x">
      <link rel="shortlink" href="https://sho.rt/42">
      <meta property="og:url" content="https://example.test/articles/42">
      <meta name="DC.identifier" content="doi:10.1000/XYZ">
      <meta name="citation_doi" content="10.1000/xyz">
      <meta name="citation_pdf_url" content="https://example.test/articles/42.pdf">`;
    const page = collectPageMetadata(document);
    expect(page).toMatchObject({
      url: window.location.href,
      title: 'A paper',
      canonical: '/articles/42?utm_source=x',
      shortlink: 'https://sho.rt/42',
      ogUrl: 'https://example.test/articles/42',
      dcIdentifiers: ['doi:10.1000/XYZ'],
      doi: '10.1000/xyz',
      pdfUrl: 'https://example.test/articles/42.pdf',
    });
    const doc = collectDocument(document);
    expect(doc.uri).toBe(window.location.href);
    expect(doc.title).toBe('A paper');
    expect(doc.links[0]).toEqual({ uri: window.location.href, relation: 'self' });
    expect(doc.links.map((l) => l.relation)).toContain('doi');
    expect(doc.links.map((l) => l.relation)).toContain('shortlink');
    // The DOI reaches the sidebar as the page wrote it; normalization is the model's.
    expect(doc.links.find((l) => l.relation === 'doi')?.uri).toBe('10.1000/xyz');
  });

  it('reports only the page URL when the page says nothing else', () => {
    document.head.innerHTML = '';
    const doc = collectDocument(document);
    expect(doc.links).toEqual([{ uri: window.location.href, relation: 'self' }]);
    expect(doc.title).toBeUndefined();
  });
});
