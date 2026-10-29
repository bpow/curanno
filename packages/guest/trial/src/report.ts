/** Result shapes and the Markdown summary written next to results.json. */
import { classify, emptyCounts, type Counts, type Verdict } from './classify.ts';

export type AnnotationResult = {
  caseId: string;
  variantId: string;
  annotationId: string;
  candidateId: string;
  verdict: Verdict;
  expected: { start: number; end: number } | 'mustNotMatch' | null;
  actual: { start: number; end: number } | null;
  actualText?: string;
  via?: string;
  score?: number;
  error?: string;
};

export type Results = {
  generated: string;
  candidates: { id: string; description: string; sweep?: boolean }[];
  cases: {
    id: string;
    title: string;
    kind: string;
    tags: string[];
    variants: string[];
    annotations: number;
  }[];
  /** Milliseconds per candidate per case/variant, all annotations together. */
  timings: {
    caseId: string;
    variantId: string;
    candidateId: string;
    ms: number;
    textLength: number;
  }[];
  results: AnnotationResult[];
};

export function tally(results: AnnotationResult[]): Counts {
  const counts = emptyCounts();
  for (const r of results) counts[r.verdict]++;
  return counts;
}

function pct(n: number, d: number): string {
  return d === 0 ? '–' : `${Math.round((100 * n) / d)}%`;
}

function countsRow(label: string, counts: Counts): string {
  const expectedMatch = counts.anchored + counts.approximate + counts.missed + counts.wrong;
  const mustNot = counts.orphaned + counts.guessed;
  return `| ${label} | ${counts.anchored} | ${counts.approximate} | ${counts.missed} | ${counts.wrong} | ${pct(counts.anchored + counts.approximate, expectedMatch)} | ${counts.orphaned} | ${counts.guessed} | ${pct(counts.orphaned, mustNot)} |`;
}

const HEADER = `| Candidate | Anchored | Approximate | Missed | Wrong | Recall | Orphaned (correct) | Guessed | Must-not-match held |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`;

export function summaryMarkdown(r: Results): string {
  const lines: string[] = [];
  lines.push('# Anchoring trial results', '', `Generated ${r.generated}.`, '');
  lines.push(
    'Each row counts one annotation on one variant. "Recall" is anchored plus approximate over all annotations whose text exists in the variant. "Must-not-match held" is the share of `mustNotMatch` annotations correctly reported as orphans. Verdicts are defined in `trial/src/classify.ts`.',
    '',
  );
  lines.push('## Candidates', '');
  for (const c of r.candidates) lines.push(`- **${c.id}**: ${c.description}`);
  lines.push('');

  lines.push('## All cases', '', HEADER);
  for (const c of r.candidates) {
    lines.push(countsRow(c.id, tally(r.results.filter((x) => x.candidateId === c.id))));
  }
  lines.push('');

  const editedOnly = r.results.filter((x) => x.variantId !== 'original');
  lines.push(
    '## Edited variants only',
    '',
    'The original variant should anchor for every candidate; this table leaves it out.',
    '',
    HEADER,
  );
  for (const c of r.candidates) {
    lines.push(countsRow(c.id, tally(editedOnly.filter((x) => x.candidateId === c.id))));
  }
  lines.push('');

  const tags = [...new Set(r.cases.flatMap((c) => c.tags))].sort();
  lines.push('## By tag (edited variants)', '');
  for (const tag of tags) {
    const caseIds = new Set(r.cases.filter((c) => c.tags.includes(tag)).map((c) => c.id));
    const subset = editedOnly.filter((x) => caseIds.has(x.caseId));
    if (subset.length === 0) continue;
    lines.push(`### ${tag}`, '', HEADER);
    for (const c of r.candidates) {
      lines.push(countsRow(c.id, tally(subset.filter((x) => x.candidateId === c.id))));
    }
    lines.push('');
  }

  lines.push('## By case and variant', '');
  lines.push(`| Case | Variant | ${r.candidates.map((c) => c.id).join(' | ')} |`);
  lines.push(`| --- | --- | ${r.candidates.map(() => '---').join(' | ')} |`);
  for (const c of r.cases) {
    for (const v of c.variants) {
      const cells = r.candidates.map((cand) => {
        const subset = r.results.filter(
          (x) => x.caseId === c.id && x.variantId === v && x.candidateId === cand.id,
        );
        const t = tally(subset);
        const bad = [
          t.missed ? `${t.missed} missed` : '',
          t.wrong ? `${t.wrong} wrong` : '',
          t.guessed ? `${t.guessed} guessed` : '',
          t.approximate ? `${t.approximate} approx` : '',
          t.invalid ? `${t.invalid} invalid` : '',
        ].filter(Boolean);
        return `${t.anchored + t.approximate + t.orphaned}/${subset.length}${bad.length ? ` (${bad.join(', ')})` : ''}`;
      });
      lines.push(`| ${c.id} | ${v} | ${cells.join(' | ')} |`);
    }
  }
  lines.push('');

  lines.push('## Failures in detail', '');
  const failures = r.results.filter((x) =>
    ['missed', 'wrong', 'guessed', 'invalid'].includes(x.verdict),
  );
  if (failures.length === 0) lines.push('None.');
  else {
    lines.push(
      '| Case | Variant | Annotation | Candidate | Verdict | Got |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const f of failures) {
      const got = f.actualText
        ? `“${f.actualText.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 60)}”`
        : f.error
          ? `error: ${f.error.replace(/\|/g, '\\|').slice(0, 60)}`
          : '—';
      lines.push(
        `| ${f.caseId} | ${f.variantId} | ${f.annotationId} | ${f.candidateId} | ${f.verdict} | ${got} |`,
      );
    }
  }
  lines.push('');

  const sweepCandidates = r.candidates.filter((c) => c.sweep);
  for (const cand of sweepCandidates) {
    lines.push(
      `## Score threshold sweep for ${cand.id}`,
      '',
      'Edited variants only. Each row re-reads the same answers, treating any quote match whose score is below the threshold as an orphan. Position hits (score 1) are unaffected. This is the lever between recall and false anchors; the Hypothesis matcher scores identically, so the curve applies to it too.',
      '',
      '| Minimum score | Recall | Must-not-match held | Missed | Guessed |',
      '| ---: | ---: | ---: | ---: | ---: |',
    );
    for (const t of [0, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]) {
      const counts = emptyCounts();
      for (const x of editedOnly.filter((x) => x.candidateId === cand.id)) {
        const dropped = x.actual !== null && (x.score ?? 1) < t;
        counts[dropped ? classify(x.expected, null) : x.verdict]++;
      }
      const expectedMatch = counts.anchored + counts.approximate + counts.missed + counts.wrong;
      const mustNot = counts.orphaned + counts.guessed;
      lines.push(
        `| ${t.toFixed(2)} | ${pct(counts.anchored + counts.approximate, expectedMatch)} | ${pct(counts.orphaned, mustNot)} | ${counts.missed} | ${counts.guessed} |`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## Timing',
    '',
    "Milliseconds to anchor all of a variant's annotations, by candidate (longest documents first).",
    '',
  );
  lines.push(`| Case | Variant | Text length | ${r.candidates.map((c) => c.id).join(' | ')} |`);
  lines.push(`| --- | --- | ---: | ${r.candidates.map(() => '---:').join(' | ')} |`);
  const keys = [...new Map(r.timings.map((t) => [`${t.caseId}/${t.variantId}`, t])).values()].sort(
    (a, b) => b.textLength - a.textLength,
  );
  for (const k of keys) {
    const cells = r.candidates.map((c) => {
      const t = r.timings.find(
        (x) => x.caseId === k.caseId && x.variantId === k.variantId && x.candidateId === c.id,
      );
      return t ? String(Math.round(t.ms)) : '–';
    });
    lines.push(`| ${k.caseId} | ${k.variantId} | ${k.textLength} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}
