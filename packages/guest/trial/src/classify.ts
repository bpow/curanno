/**
 * Turns one candidate's answer for one annotation into a verdict. Pure, so
 * it can be unit tested without a browser.
 */
export type Span = { start: number; end: number };

export type Verdict =
  /** Exactly the expected text. */
  | 'anchored'
  /** Overlaps the expected text by at least half (intersection over union). */
  | 'approximate'
  /** Reported no match where a match existed. */
  | 'missed'
  /** Reported no match, and no match existed. The right answer. */
  | 'orphaned'
  /** Returned a range that is not the expected text. */
  | 'wrong'
  /** Returned a range for a `mustNotMatch` annotation. The worst answer. */
  | 'guessed'
  /** The expected text could not be located in the variant: corpus error. */
  | 'invalid';

export const APPROXIMATE_IOU = 0.5;

export function classify(expected: Span | null | 'mustNotMatch', actual: Span | null): Verdict {
  if (expected === 'mustNotMatch') return actual ? 'guessed' : 'orphaned';
  if (expected === null) return 'invalid';
  if (!actual) return 'missed';
  if (actual.start === expected.start && actual.end === expected.end) return 'anchored';
  const inter = Math.max(
    0,
    Math.min(actual.end, expected.end) - Math.max(actual.start, expected.start),
  );
  const union = Math.max(actual.end, expected.end) - Math.min(actual.start, expected.start);
  if (union > 0 && inter / union >= APPROXIMATE_IOU) return 'approximate';
  return 'wrong';
}

export const VERDICTS: Verdict[] = [
  'anchored',
  'approximate',
  'missed',
  'orphaned',
  'wrong',
  'guessed',
  'invalid',
];

export type Counts = Record<Verdict, number>;

export function emptyCounts(): Counts {
  return { anchored: 0, approximate: 0, missed: 0, orphaned: 0, wrong: 0, guessed: 0, invalid: 0 };
}
