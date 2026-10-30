import { describe, expect, it } from 'vitest';
import { fileUrlFrom, nameOf, viewerUrlFor } from './source.js';

describe('fileUrlFrom', () => {
  it('accepts absolute http(s) URLs only', () => {
    expect(fileUrlFrom('?file=https%3A%2F%2Fexample.org%2Fa.pdf%23page%3D2')).toBe(
      'https://example.org/a.pdf',
    );
    expect(fileUrlFrom('?file=http://example.org/a.pdf')).toBe('http://example.org/a.pdf');
    expect(fileUrlFrom('?file=/local.pdf')).toBeUndefined();
    expect(fileUrlFrom('?file=javascript:alert(1)')).toBeUndefined();
    expect(fileUrlFrom('?file=file:///etc/passwd')).toBeUndefined();
    expect(fileUrlFrom('')).toBeUndefined();
  });
});

describe('viewerUrlFor', () => {
  it('builds the viewer URL with the PDF in the file parameter', () => {
    expect(viewerUrlFor('https://pdf.annotations.example/pdf/', 'https://e.org/a b.pdf')).toBe(
      'https://pdf.annotations.example/pdf/?file=https%3A%2F%2Fe.org%2Fa+b.pdf',
    );
  });
});

describe('nameOf', () => {
  it('uses the last path segment', () => {
    expect(nameOf('https://example.org/papers/ten%20rules.pdf?x=1')).toBe('ten rules.pdf');
    expect(nameOf('https://example.org/')).toBe('https://example.org/');
  });
});
