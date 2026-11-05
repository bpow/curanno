import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  apiOrigin,
  excludedOrigins,
  mergeSettings,
  sidebarLocation,
  validateSettings,
} from './settings.js';

const deployed = {
  sidebarUrl: 'https://curanno.example/sidebar/',
  apiUrl: '',
  pdfViewerUrl: 'https://pdf.curanno.example/pdf/',
  publicCounts: false,
};

describe('validateSettings', () => {
  it('accepts the defaults and a deployment', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({});
    expect(validateSettings(deployed)).toEqual({});
    expect(validateSettings({ ...deployed, apiUrl: 'https://api.example/' })).toEqual({});
  });

  it('names each unusable field', () => {
    const problems = validateSettings({
      sidebarUrl: 'javascript:alert(1)',
      apiUrl: 'https://api.example/base',
      pdfViewerUrl: 'file:///viewer.html',
      publicCounts: true,
    });
    expect(Object.keys(problems).sort()).toEqual(['apiUrl', 'pdfViewerUrl', 'sidebarUrl']);
    expect(validateSettings({ ...deployed, sidebarUrl: 'not a url' }).sidebarUrl).toMatch(/http/);
  });
});

describe('mergeSettings', () => {
  it('keeps stored values of the right type over the defaults', () => {
    expect(
      mergeSettings({ sidebarUrl: deployed.sidebarUrl, publicCounts: 'yes', extra: 1 }),
    ).toEqual({ ...DEFAULT_SETTINGS, sidebarUrl: deployed.sidebarUrl });
  });
});

describe('derived locations', () => {
  it('splits the sidebar URL and falls back to its origin for the API', () => {
    expect(sidebarLocation(deployed)).toEqual({
      sidebarOrigin: 'https://curanno.example',
      sidebarPath: '/sidebar/',
    });
    expect(apiOrigin(deployed)).toBe('https://curanno.example');
    expect(apiOrigin({ ...deployed, apiUrl: 'https://api.example' })).toBe('https://api.example');
  });

  it('excludes the sidebar origin, and the viewer origin when there is one', () => {
    expect(excludedOrigins(deployed)).toEqual([
      'https://curanno.example',
      'https://pdf.curanno.example',
    ]);
    expect(excludedOrigins({ ...deployed, pdfViewerUrl: '' })).toEqual(['https://curanno.example']);
  });
});
