import { describe, expect, it } from 'vitest';
import { classify } from './classify.ts';

describe('classify', () => {
  it('reports exact matches as anchored', () => {
    expect(classify({ start: 10, end: 20 }, { start: 10, end: 20 })).toBe('anchored');
  });
  it('reports large overlaps as approximate', () => {
    expect(classify({ start: 10, end: 20 }, { start: 11, end: 20 })).toBe('approximate');
    expect(classify({ start: 10, end: 20 }, { start: 10, end: 14 })).toBe('wrong');
  });
  it('distinguishes a correct orphan from a missed anchor', () => {
    expect(classify('mustNotMatch', null)).toBe('orphaned');
    expect(classify({ start: 0, end: 5 }, null)).toBe('missed');
  });
  it('calls any range on a mustNotMatch annotation a guess', () => {
    expect(classify('mustNotMatch', { start: 0, end: 5 })).toBe('guessed');
  });
  it('flags an expectation that could not be located', () => {
    expect(classify(null, { start: 0, end: 5 })).toBe('invalid');
  });
});
