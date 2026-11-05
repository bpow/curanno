import { describe, expect, it } from 'vitest';
import { isAnchorCountMessage } from './messages.js';
import { badgeText, isPdfResponse, isWebPage, publicCountUrl, viewerUrlFor } from './pages.js';

describe('isPdfResponse', () => {
  it('recognizes a PDF the browser will show, whatever the header case', () => {
    expect(isPdfResponse([{ name: 'Content-Type', value: 'application/pdf' }])).toBe(true);
    expect(isPdfResponse([{ name: 'content-type', value: 'Application/PDF; qs=0.9' }])).toBe(true);
  });

  it('leaves other types, downloads and missing headers alone', () => {
    expect(isPdfResponse([{ name: 'content-type', value: 'text/html' }])).toBe(false);
    expect(
      isPdfResponse([
        { name: 'content-type', value: 'application/pdf' },
        { name: 'Content-Disposition', value: 'attachment; filename="a.pdf"' },
      ]),
    ).toBe(false);
    expect(
      isPdfResponse([
        { name: 'content-type', value: 'application/pdf' },
        { name: 'content-disposition', value: 'inline; filename="a.pdf"' },
      ]),
    ).toBe(true);
    expect(isPdfResponse(undefined)).toBe(false);
  });
});

describe('addresses', () => {
  it('puts the PDF in the viewer’s file parameter', () => {
    const url = new URL(viewerUrlFor('https://pdf.example/pdf/', 'https://x.example/a b.pdf?v=1'));
    expect(url.origin + url.pathname).toBe('https://pdf.example/pdf/');
    expect(url.searchParams.get('file')).toBe('https://x.example/a b.pdf?v=1');
  });

  it('searches one page anonymously for its total', () => {
    const url = new URL(publicCountUrl('https://curanno.example', 'https://x.example/p?q=1#h'));
    expect(url.pathname).toBe('/x/search');
    expect(url.searchParams.get('uri')).toBe('https://x.example/p?q=1#h');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('counts only http(s) pages as web pages', () => {
    expect(isWebPage('https://x.example/')).toBe(true);
    expect(isWebPage('chrome://extensions/')).toBe(false);
    expect(isWebPage(undefined)).toBe(false);
  });
});

describe('badgeText', () => {
  it('shows nothing for no annotations and caps large counts', () => {
    expect(badgeText(undefined)).toBe('');
    expect(badgeText(0)).toBe('');
    expect(badgeText(12)).toBe('12');
    expect(badgeText(1000)).toBe('999+');
  });
});

describe('isAnchorCountMessage', () => {
  it('accepts a non-negative integer count only', () => {
    expect(isAnchorCountMessage({ type: 'anchor-count', count: 3 })).toBe(true);
    expect(isAnchorCountMessage({ type: 'anchor-count', count: -1 })).toBe(false);
    expect(isAnchorCountMessage({ type: 'anchor-count', count: 1.5 })).toBe(false);
    expect(isAnchorCountMessage({ type: 'other', count: 1 })).toBe(false);
    expect(isAnchorCountMessage(null)).toBe(false);
  });
});
