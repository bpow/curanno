/**
 * Runs every candidate against every case and variant of the corpus and
 * writes `trial/results/results.json` and `summary.md`.
 *
 *   pnpm --filter @scale/guest trial [--candidate id] [case-id ...]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from './build.ts';
import { classify } from './classify.ts';
import { expectationFor, loadCases } from './corpus.ts';
import { launch, openVariant, rootSelector } from './page.ts';
import { summaryMarkdown, type AnnotationResult, type Results } from './report.ts';
import { startServer } from './server.ts';

const RESULTS_DIR = path.resolve(import.meta.dirname, '../results');

const args = process.argv.slice(2);
const onlyCandidates: string[] = [];
const ids: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--candidate') onlyCandidates.push(args[++i]);
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
      candidates = await probe.evaluate(() => window.__trial.candidates);
      const root = rootSelector(c);
      const textLength = await probe.evaluate((r) => window.__trial.textLength(r), root);
      const expected = await probe.evaluate(
        ([r, items]) => items.map((i) => window.__trial.expectedSpan(r, i.expected)),
        [root, c.annotations.map((a) => ({ expected: expectationFor(a, v.id) }))] as const,
      );
      await probe.close();

      for (const cand of candidates) {
        if (onlyCandidates.length > 0 && !onlyCandidates.includes(cand.id)) continue;
        const page = await openVariant(browser, c, v, server.origin);
        const items = c.annotations.map((a) => {
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
        c.annotations.forEach((a, i) => {
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
          `${c.id}/${v.id} ${cand.id}: ${c.annotations.length - bad}/${c.annotations.length} ok, ${Math.round(ms)} ms`,
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
    annotations: c.annotations.length,
  })),
  timings,
  results,
};
await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(path.join(RESULTS_DIR, 'results.json'), JSON.stringify(out, null, 2) + '\n');
await writeFile(path.join(RESULTS_DIR, 'summary.md'), summaryMarkdown(out) + '\n');
const invalid = results.filter((r) => r.verdict === 'invalid');
if (invalid.length > 0) {
  console.error(`${invalid.length} expectations could not be located; fix the corpus:`);
  for (const r of invalid) console.error(`  ${r.caseId}/${r.variantId}/${r.annotationId}`);
  process.exit(1);
}
console.log(`wrote ${RESULTS_DIR}/results.json and summary.md`);
