/**
 * Highlight rendering comparison: wrapped elements, Recogito's overlay spans
 * and the CSS Custom Highlight API, on the pages that re-render their DOM
 * and on the nested-scroll page. Writes `results/highlights.json`; the
 * evaluation is in `highlight-rendering.md`.
 *
 *   pnpm --filter @curanno/guest trial:highlights
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from './build.ts';
import { loadCases, type Case } from './corpus.ts';
import { launch, openVariant, rootSelector } from './page.ts';
import type { Page } from 'playwright';
import { countVisible } from './visible.ts';
import { startServer } from './server.ts';

const RESULTS_DIR = path.resolve(import.meta.dirname, '../results');
const TECHNIQUES = ['wrap', 'overlay', 'css-highlight'] as const;
type Technique = (typeof TECHNIQUES)[number];
type Span = { start: number; end: number };

type Step = {
  step: string;
  /** Annotations whose highlight is painted over their text. */
  visible: number;
  of: number;
  /** Root textContent equals a clean render of the same state. */
  textIntact: boolean | null;
  consoleErrors: number;
  /** Overlay only: pixel distance between the highlight and its text, per annotation. */
  overlayOffsets?: (number | null)[];
  elementsAdded?: number;
};

type Row = { caseId: string; technique: Technique; steps: Step[] };

await build();
const server = await startServer();
const browser = await launch();
const rows: Row[] = [];

async function spansFor(page: Page, c: Case): Promise<Span[]> {
  const root = rootSelector(c);
  const items = c.annotations
    .filter((a) => !a.notAnnotatable)
    .filter((a) => !a.expected?.['data-2'] || !('mustNotMatch' in a.expected['data-2']))
    .map((a) => ({ id: a.id, selectors: a.selectors! }));
  const { results } = await page.evaluate(
    ([r, items]) => window.__trial.anchor('guest', r, items),
    [root, items] as const,
  );
  return results.map((r) => r.span).filter((s): s is Span => s !== null);
}

async function cleanText(c: Case, variantId: string): Promise<string> {
  const v = c.variants.find((x) => x.id === variantId)!;
  const page = await openVariant(browser, c, v, server.origin);
  const text = await page.evaluate(
    (r) => (r ? document.querySelector(r)! : document.body).textContent ?? '',
    rootSelector(c),
  );
  await page.close();
  return text;
}

try {
  const cases = await loadCases(['react-rerender', 'vue-rerender', 'synth-scroll']);
  for (const c of cases) {
    const original = c.variants.find((v) => v.id === 'original')!;
    const root = rootSelector(c);
    const framework = c.id.endsWith('-rerender');
    const cleanPatched = framework ? await cleanText(c, 'data-2') : null;
    const cleanOriginal = await cleanText(c, 'original');

    for (const technique of TECHNIQUES) {
      const page = await openVariant(browser, c, original, server.origin);
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      const spans = await spansFor(page, c);
      const steps: Step[] = [];
      const textOf = () =>
        page.evaluate(
          (r) => (r ? document.querySelector(r)! : document.body).textContent ?? '',
          root,
        );

      const elementsAdded = await page.evaluate(([t, r, s]) => window.__trialHl.draw(t, r, s), [
        technique,
        root,
        spans,
      ] as const);
      steps.push({
        step: 'drawn',
        visible: await countVisible(
          page,
          root,
          spans,
          process.env['TRIAL_DUMP']
            ? `${process.env['TRIAL_DUMP']}/${c.id}-${technique}`
            : undefined,
        ),
        of: spans.length,
        textIntact: (await textOf()) === cleanOriginal,
        consoleErrors: errors.length,
        elementsAdded,
      });

      if (framework) {
        // In-place patch: the framework updates the existing nodes it owns.
        await page.evaluate(() => window.__app.render(2));
        await page.waitForTimeout(100);
        const patchedSpans = await spansFor(page, c);
        steps.push({
          step: 'after-patch',
          visible: await countVisible(page, root, patchedSpans),
          of: patchedSpans.length,
          textIntact: (await textOf()) === cleanPatched,
          consoleErrors: errors.length,
        });

        // Remount: every node replaced, same text as the original.
        await page.evaluate(() => window.__app.render(1, 'remount-'));
        await page.waitForTimeout(100);
        steps.push({
          step: 'after-remount',
          visible: await countVisible(page, root, spans),
          of: spans.length,
          textIntact: (await textOf()) === cleanOriginal,
          consoleErrors: errors.length,
        });

        // What a guest would do next: re-anchor against the new DOM and redraw.
        await page.evaluate(([t, r, s]) => window.__trialHl.redraw(t, r, s), [
          technique,
          root,
          spans,
        ] as const);
        await page.waitForTimeout(100);
        steps.push({
          step: 'after-redraw',
          visible: await countVisible(page, root, spans),
          of: spans.length,
          textIntact: (await textOf()) === cleanOriginal,
          consoleErrors: errors.length,
        });
      } else {
        // Nested scroll: scroll the inner container and the outer one, then check alignment.
        await page.evaluate(() => {
          document.querySelector('#notes')!.scrollTop += 120;
          document.querySelector('.outer')!.scrollTop += 80;
        });
        await page.waitForTimeout(300);
        const step: Step = {
          step: 'after-scroll',
          visible: await countVisible(page, root, spans),
          of: spans.length,
          textIntact: null,
          consoleErrors: errors.length,
        };
        if (technique === 'overlay') {
          step.overlayOffsets = await page.evaluate(
            ([r, s]) => window.__trialHl.overlayOffsets(r, s),
            [root, spans] as const,
          );
        }
        steps.push(step);
        await page.setViewportSize({ width: 900, height: 700 });
        await page.waitForTimeout(300);
        const resized: Step = {
          step: 'after-resize',
          visible: await countVisible(page, root, spans),
          of: spans.length,
          textIntact: null,
          consoleErrors: errors.length,
        };
        if (technique === 'overlay') {
          resized.overlayOffsets = await page.evaluate(
            ([r, s]) => window.__trialHl.overlayOffsets(r, s),
            [root, spans] as const,
          );
        }
        steps.push(resized);
      }
      rows.push({ caseId: c.id, technique, steps });
      console.log(
        `${c.id} ${technique}: ${steps.map((s) => `${s.step} ${s.visible}/${s.of}${s.textIntact === false ? ' TEXT-CORRUPTED' : ''}${s.consoleErrors ? ` ${s.consoleErrors} errors` : ''}`).join(' | ')}`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(
  path.join(RESULTS_DIR, 'highlights.json'),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), rows }, null, 2) + '\n',
);
console.log(`wrote ${RESULTS_DIR}/highlights.json`);
