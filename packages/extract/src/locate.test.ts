import { describe, expect, it } from 'vitest';
import { locateQuote } from './locate.js';
import { buildView } from './view.js';

const whole = { start: 0, end: Number.MAX_SAFE_INTEGER };

function slice(source: string, located: ReturnType<typeof locateQuote>): string | undefined {
  return located.ok ? source.slice(located.start, located.end) : undefined;
}

describe('locateQuote', () => {
  it('finds a verbatim quote', () => {
    const view = buildView('The proband had seizures at age 2. Her sister was unaffected.');
    const located = locateQuote(view, 'had seizures at age 2', whole);
    expect(located).toEqual({ ok: true, start: 12, end: 33 });
  });

  it('allows differences in whitespace, quotes and dashes', () => {
    const source = 'He said “no change” after the 3–4 week trial.';
    const view = buildView(source);
    expect(slice(source, locateQuote(view, 'said "no change"  after the 3-4 week', whole))).toBe(
      'said “no change” after the 3–4 week',
    );
  });

  it('matches across a block start the model saw as a paragraph break', () => {
    const source = 'Case 1 was male.Case 2 was female.';
    const view = buildView(source, [16]);
    expect(view.text).toBe('Case 1 was male.\n\nCase 2 was female.');
    expect(slice(source, locateQuote(view, 'was male. Case 2', whole))).toBe('was male.Case 2');
    expect(slice(source, locateQuote(view, 'Case 2 was female.', whole))).toBe(
      'Case 2 was female.',
    );
  });

  it('rejects a quote the model reworded', () => {
    const view = buildView('The proband had seizures at age 2.');
    expect(locateQuote(view, 'the patient had seizures', whole)).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('rejects quotes too short to trust', () => {
    expect(locateQuote(buildView('a b c'), ' b ', whole)).toEqual({
      ok: false,
      reason: 'too-short',
    });
  });

  it('settles repeated text by the chunk the quote came from', () => {
    const source = 'Variant found. Later: Variant found.';
    const view = buildView(source);
    expect(locateQuote(view, 'Variant found', whole)).toEqual({ ok: false, reason: 'ambiguous' });
    expect(locateQuote(view, 'Variant found', { start: 15, end: source.length })).toEqual({
      ok: true,
      start: 22,
      end: 35,
    });
  });

  it('trims whitespace the quote carried at either end', () => {
    const source = 'one two three';
    expect(slice(source, locateQuote(buildView(source), ' two three ', whole))).toBe('two three');
  });
});
