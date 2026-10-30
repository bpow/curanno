import { describe, expect, it } from 'vitest';
import { bookmarkletSource, bookmarkletUrl } from './bookmarklet.js';

const options = {
  bundleUrl: 'https://annotations.example/guest.js',
  sidebarOrigin: 'https://annotations.example',
  sidebarPath: '/sidebar/',
};

describe('bookmarklet', () => {
  it('injects the bundle with the sidebar location and nothing else', () => {
    const source = bookmarkletSource(options);
    expect(source).toContain('s.src="https://annotations.example/guest.js"');
    expect(source).toContain(`'data-sidebar-origin',"https://annotations.example"`);
    expect(source).toContain(`'data-sidebar-path',"/sidebar/"`);
    expect(source).not.toContain('contentType');
    expect(bookmarkletUrl(options).startsWith('javascript:')).toBe(true);
  });

  it('sends a tab showing a PDF to the viewer when one is configured', () => {
    const source = bookmarkletSource({
      ...options,
      pdfViewerUrl: 'https://pdf.annotations.example/pdf/',
    });
    expect(source).toContain("document.contentType==='application/pdf'");
    expect(source).toContain('new URL("https://pdf.annotations.example/pdf/")');
    expect(source).toContain("u.searchParams.set('file',location.href)");
  });

  it('refuses a sidebar path that leaves the origin', () => {
    expect(() => bookmarkletSource({ ...options, sidebarPath: 'https://evil.example/' })).toThrow();
  });
});
