/**
 * Runs every candidate against every case and variant of the corpus and
 * writes `trial/results/results.json` and `summary.md`.
 *
 *   pnpm --filter @scale/guest trial [--all] [--candidate id] [case-id ...]
 *
 * Runs the guest candidates unless `--all` adds the Phase 2 ones. Exits 1
 * when the guest guesses on a `mustNotMatch` annotation (plan, section 8,
 * success criterion 5) or when an expectation cannot be located.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from './build.ts';
import { classify } from './classify.ts';
import { expectationFor, loadCases } from './corpus.ts';
import { launch, openVariant, rootSelector } from './page.ts';
import {
  GUEST_CANDIDATE_ID,
  summaryMarkdown,
  type AnnotationResult,
  type Results,
} from './report.ts';
import { startServer } from './server.ts';

const RESULTS_DIR = path.resolve(import.meta.dirname, '../results');

const args = process.argv.slice(2);
const onlyCandidates: string[] = [];
const ids: string[] = [];
let all = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--candidate') onlyCandidates.push(args[++i]);
  else if (args[i] === '--all') all = true;
  else ids.push(args[i]);
}

await build();
const cases = await loadCases(ids);
const server = await startServer();
const browser = await launch();
const results: AnnotationResult[] = [];
const timings: Results['timings'] = [];
let candidates: Results['candidates'] = [];

try {
  for (const c of cases) {
    for (const v of c.variants) {
      // One page load per candidate so none sees another's DOM changes.
      const probe = await openVariant(browser, c, v, server.origin);
      candidates = (await probe.evaluate(() => window.__trial.candidates)).filter(
        (cand) => all || !cand.legacy || onlyCandidates.includes(cand.id),
      );
      const root = rootSelector(c);
      const textLength = await probe.evaluate((r) => window.__trial.textLength(r), root);
      const annotations = c.annotations.filter((a) => !a.notAnnotatable);
      const expected = await probe.evaluate(
        ([r, items]) => items.map((i) => window.__trial.expectedSpan(r, i.expected)),
        [root, annotations.map((a) => ({ expected: expectationFor(a, v.id) }))] as const,
      );
      await probe.close();

      for (const cand of candidates) {
        if (onlyCandidates.length > 0 && !onlyCandidates.includes(cand.id)) continue;
        const page = await openVariant(browser, c, v, server.origin);
        const items = annotations.map((a) => {
          if (!a.selectors)
            throw new Error(`${c.id}/${a.id} has no selectors; run corpus:describe`);
          return { id: a.id, selectors: a.selectors };
        });
        const { results: answers, ms } = await page.evaluate(
          ([id, r, items]) => window.__trial.anchor(id, r, items),
          [cand.id, root, items] as const,
        );
        const texts = await page.evaluate(
          ([r, spans]) => {
            const root = r ? document.querySelector(r)! : document.body;
            const text = root.textContent ?? '';
            return spans.map((s) => (s ? text.slice(s.start, s.end) : undefined));
          },
          [root, answers.map((a) => a.span)] as const,
        );
        await page.close();
        timings.push({ caseId: c.id, variantId: v.id, candidateId: cand.id, ms, textLength });
        annotations.forEach((a, i) => {
          const exp = expectationFor(a, v.id);
          const expectedSpan = 'mustNotMatch' in exp ? ('mustNotMatch' as const) : expected[i];
          const answer = answers[i];
          const verdict = classify(expectedSpan, answer.span);
          results.push({
            caseId: c.id,
            variantId: v.id,
            annotationId: a.id,
            candidateId: cand.id,
            verdict,
            expected: expectedSpan,
            actual: answer.span,
            ...(texts[i] !== undefined ? { actualText: texts[i] } : {}),
            ...(answer.via ? { via: answer.via } : {}),
            ...(answer.score !== undefined ? { score: answer.score } : {}),
            ...(answer.error ? { error: answer.error } : {}),
          });
        });
        const bad = results.filter(
          (x) =>
            x.caseId === c.id &&
            x.variantId === v.id &&
            x.candidateId === cand.id &&
            !['anchored', 'orphaned'].includes(x.verdict),
        ).length;
        console.log(
          `${c.id}/${v.id} ${cand.id}: ${annotations.length - bad}/${annotations.length} ok, ${Math.round(ms)} ms`,
        );
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const out: Results = {
  generated: new Date().toISOString().slice(0, 10),
  candidates,
  cases: cases.map((c) => ({
    id: c.id,
    title: c.title,
    kind: c.kind,
    tags: c.tags,
    variants: c.variants.map((v) => v.id),
    annotations: c.annotations.filter((a) => !a.notAnnotatable).length,
  })),
  timings,
  results,
};
await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(path.join(RESULTS_DIR, 'results.json'), JSON.stringify(out, null, 2) + '\n');
await writeFile(path.join(RESULTS_DIR, 'summary.md'), summaryMarkdown(out) + '\n');
console.log(`wrote ${RESULTS_DIR}/results.json and summary.md`);
const invalid = results.filter((r) => r.verdict === 'invalid');
if (invalid.length > 0) {
  console.error(`${invalid.length} expectations could not be located; fix the corpus:`);
  for (const r of invalid) console.error(`  ${r.caseId}/${r.variantId}/${r.annotationId}`);
  process.exit(1);
}
const guessed = results.filter(
  (r) => r.candidateId === GUEST_CANDIDATE_ID && r.verdict === 'guessed',
);
if (guessed.length > 0) {
  console.error(`${guessed.length} must-not-match annotations were anchored by the guest:`);
  for (const r of guessed) {
    console.error(
      `  ${r.caseId}/${r.variantId}/${r.annotationId}: ${JSON.stringify(r.actualText)}`,
    );
  }
  process.exit(1);
}
