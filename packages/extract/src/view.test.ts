import { describe, expect, it } from 'vitest';
import { buildView, toSource } from './view.js';

describe('buildView', () => {
  it('puts a blank line before each block start', () => {
    const view = buildView('onetwothree', [3, 6]);
    expect(view.text).toBe('one\n\ntwo\n\nthree');
  });

  it('ignores starts at the ends and repeats', () => {
    expect(buildView('abc', [0, 3, 1, 1]).text).toBe('a\n\nbc');
  });

  it('counts block starts in code points', () => {
    expect(buildView('😀ab', [1]).text).toBe('😀\n\nab');
  });
});

describe('toSource', () => {
  const view = buildView('onetwothree', [3, 6]);

  it('maps view indices back past the separators', () => {
    expect(view.text.indexOf('two')).toBe(5);
    expect(toSource(view, 5)).toBe(3);
    expect(toSource(view, view.text.indexOf('three'))).toBe(6);
    expect(toSource(view, view.text.length)).toBe(11);
    expect(toSource(view, 2)).toBe(2);
  });

  it('maps an index inside a separator to the block start', () => {
    expect(toSource(view, 3)).toBe(3);
    expect(toSource(view, 4)).toBe(3);
  });
});
