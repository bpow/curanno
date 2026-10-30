// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bookmarkletSource, bookmarkletUrl } from './bookmarklet.js';
import { readConfig, validateSidebar } from './config.js';

describe('readConfig', () => {
  it('reads the sidebar location from the script element', () => {
    const script = document.createElement('script');
    script.setAttribute('data-sidebar-origin', 'https://sidebar.example');
    script.setAttribute('data-sidebar-path', '/app/');
    expect(readConfig(script)).toEqual({
      sidebarOrigin: 'https://sidebar.example',
      sidebarPath: '/app/',
      open: true,
    });
    script.setAttribute('data-open', 'false');
    script.removeAttribute('data-sidebar-path');
    expect(readConfig(script)).toMatchObject({ sidebarPath: '/', open: false });
  });

  it('rejects missing, non-origin and non-http locations', () => {
    expect(readConfig(null)).toMatch(/script element/);
    expect(readConfig(document.createElement('script'))).toMatch(/data-sidebar-origin/);
    expect(validateSidebar('https://sidebar.example/path', '/')).toMatch(/without a path/);
    expect(validateSidebar('javascript:alert(1)', '/')).toMatch(/http/);
    expect(validateSidebar('https://sidebar.example', 'https://evil.example/')).toMatch(/leaves/);
    expect(validateSidebar('https://sidebar.example', '/ok')).toBeUndefined();
  });
});

describe('bookmarklet', () => {
  it('injects the bundle once and toggles afterwards', () => {
    const source = bookmarkletSource({
      bundleUrl: 'https://sidebar.example/guest.js',
      sidebarOrigin: 'https://sidebar.example',
    });
    expect(source).toContain('window.__scaleGuest');
    expect(source).toContain('toggleSidebar()');
    expect(source).toContain('"https://sidebar.example/guest.js"');
    expect(source).toContain(`'data-sidebar-origin',"https://sidebar.example"`);
    expect(source).toContain(`'data-sidebar-path',"/"`);
    const url = bookmarkletUrl({
      bundleUrl: 'https://sidebar.example/guest.js',
      sidebarOrigin: 'https://sidebar.example',
    });
    expect(url.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(url.slice('javascript:'.length))).toBe(source);
  });

  it('refuses a sidebar origin it could not talk to', () => {
    expect(() =>
      bookmarkletSource({ bundleUrl: 'https://x.example/g.js', sidebarOrigin: 'sidebar' }),
    ).toThrow(/not a URL/);
  });
});
