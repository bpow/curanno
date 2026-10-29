import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  codePointToUtf16,
  sliceCodePoints,
  utf16ToCodePoint,
} from './code-points.js';

describe('code point helpers', () => {
  const s = 'A😀B';
  it('counts astral characters once', () => {
    expect(codePointLength(s)).toBe(3);
    expect(codePointLength(s, 1, 3)).toBe(1);
  });
  it('converts between units', () => {
    expect(codePointToUtf16(s, 2)).toBe(3);
    expect(utf16ToCodePoint(s, 3)).toBe(2);
    expect(codePointToUtf16(s, 99)).toBe(4);
  });
  it('slices by code points', () => {
    expect(sliceCodePoints(s, 1, 2)).toBe('😀');
    expect(sliceCodePoints(s, 2)).toBe('B');
  });
});
