/**
 * The guest's own anchoring (`packages/guest/src/anchoring`), on the text
 * model. `guest` runs with the production thresholds and is the candidate
 * the regression gate applies to; `guest-sweep` runs the same code with the
 * score and length thresholds off so the report's threshold sweep shows
 * what every candidate match scored.
 */
import {
  anchor,
  createScope,
  domRangeOf,
  type AnchorOptions,
} from '../../../../src/anchoring/index.ts';
import type { Selector } from '../../corpus.ts';
import type { PdfIntegration } from '../../../../src/integrations/pdf.ts';
import { GUEST_CANDIDATE_ID } from '../../report.ts';
import { pdfIntegration } from '../pdf-integration.ts';
import { rangeToSpan } from '../text.ts';
import type { AnchorResult, Candidate } from './types.ts';

/** PDF pages go through the PDF integration, which resolves the page fragment first. */
async function anchorPdf(
  root: HTMLElement,
  pdf: PdfIntegration,
  items: { id: string; selectors: Selector[] }[],
): Promise<AnchorResult[]> {
  const results: AnchorResult[] = [];
  for (const item of items) {
    const { result, ranges } = await pdf.anchor(item.selectors);
    const range = ranges[0];
    if (result.state === 'anchored' && range) {
      results.push({ span: rangeToSpan(root, range), via: result.via, score: result.score });
    } else if (result.state === 'anchored') {
      results.push({ span: null, error: 'anchored range has no DOM range' });
    } else if (result.state === 'ambiguous') {
      results.push({ span: null, via: 'ambiguous', error: 'ambiguous' });
    } else {
      results.push({ span: null, via: 'orphaned', error: result.reason });
    }
  }
  return results;
}

function guestCandidate(id: string, description: string, options: AnchorOptions): Candidate {
  return {
    id,
    description,
    sweep: id !== GUEST_CANDIDATE_ID,
    anchorAll(root, items) {
      const pdf = pdfIntegration(root, options);
      if (pdf) return anchorPdf(root, pdf, items);
      const scope = createScope(root);
      return items.map((item): AnchorResult => {
        const result = anchor(scope, item.selectors, options);
        if (result.state === 'anchored') {
          const range = domRangeOf(scope, result.range);
          if (!range) return { span: null, error: 'anchored range has no DOM range' };
          return { span: rangeToSpan(root, range), via: result.via, score: result.score };
        }
        if (result.state === 'ambiguous') {
          return { span: null, via: 'ambiguous', score: result.score, error: 'ambiguous' };
        }
        return { span: null, via: 'orphaned', error: result.reason };
      });
    },
  };
}

export const guest = guestCandidate(
  GUEST_CANDIDATE_ID,
  'The guest on the text model (ADR 0012, 0013): RangeSelector, then TextPosition, each checked against the quote, then quote matching with the minimum score and quote-length floor from ADR 0017.',
  {},
);

export const guestSweep = guestCandidate(
  'guest-sweep',
  'The same code with the score threshold and quote-length floor turned off, recorded for the threshold sweep only.',
  { minScore: 0, minFuzzyQuoteLength: 0 },
);
