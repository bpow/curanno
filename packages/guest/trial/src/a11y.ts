/**
 * Accessibility-tree checks for the highlight techniques. Writes
 * `results/a11y.json`; findings are written up in
 * `keyboard-and-screen-reader.md`.
 *
 *   pnpm --filter @curanno/guest trial:a11y
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from './build.ts';
import { loadCases } from './corpus.ts';
import { launch, openVariant, rootSelector } from './page.ts';
import { countVisible } from './visible.ts';
import { startServer } from './server.ts';

const RESULTS_DIR = path.resolve(import.meta.dirname, '../results');
const TECHNIQUES = ['wrap', 'css-highlight'] as const;

await build();
const server = await startServer();
const browser = await launch();
const out: Record<string, unknown> = { generated: new Date().toISOString().slice(0, 10) };

try {
  const [c] = await loadCases(['react-rerender']);
  const original = c.variants.find((v) => v.id === 'original')!;
  const root = rootSelector(c);
  const items = c.annotations
    .filter((a) => !a.notAnnotatable)
    .slice(0, 3)
    .map((a) => ({ id: a.id, selectors: a.selectors! }));

  // Accessibility tree and tab order before and after each technique,
  //    and whether the highlight survives forced-colors mode.
  const tree: Record<string, unknown> = {};
  for (const technique of TECHNIQUES) {
    const page = await openVariant(browser, c, original, server.origin);
    const { results } = await page.evaluate(
      ([r, items]) => window.__trial.anchor('guest', r, items),
      [root, items] as const,
    );
    const spans = results.map((r) => r.span!).filter(Boolean);
    const article = page.locator('article.issue').first();
    const before = await article.ariaSnapshot();
    const tabStopsBefore = await countTabStops(page);
    await page.evaluate(([t, r, s]) => window.__trialHl.draw(t, r, s), [
      technique,
      root,
      spans,
    ] as const);
    const after = await article.ariaSnapshot();
    const tabStopsAfter = await countTabStops(page);
    const highlightRoles = await page.evaluate(() => {
      const els = [...document.querySelectorAll('mark[data-trial]')];
      return [
        ...new Set(
          els.map(
            (e) =>
              `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''}${e.getAttribute('aria-hidden') ? '[aria-hidden]' : ''}`,
          ),
        ),
      ];
    });
    const visibleNormal = await countVisible(page, root, spans);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.waitForTimeout(100);
    const visibleForced = await countVisible(page, root, spans);
    // Opting the highlight out of forced colours, which a guest could do.
    await page.addStyleTag({
      content:
        'mark[data-trial] { forced-color-adjust: none; } ::highlight(trial) { forced-color-adjust: none; }',
    });
    await page.waitForTimeout(100);
    const visibleForcedAdjusted = await countVisible(page, root, spans);
    tree[technique] = {
      ariaSnapshotChanged: before !== after,
      ariaSnapshotBefore: before,
      ariaSnapshotAfter: after,
      tabStopsBefore,
      tabStopsAfter,
      highlightElements: highlightRoles,
      visibleNormal: `${visibleNormal}/${spans.length}`,
      visibleForcedColors: `${visibleForced}/${spans.length}`,
      visibleForcedColorsWithAdjustNone: `${visibleForcedAdjusted}/${spans.length}`,
    };
    console.log(
      `${technique}: aria changed=${before !== after} tabstops ${tabStopsBefore}->${tabStopsAfter} forced-colors ${visibleForced}/${spans.length}, with forced-color-adjust none ${visibleForcedAdjusted}/${spans.length}`,
    );
    await page.close();
  }
  out['highlights'] = tree;
} finally {
  await browser.close();
  await server.close();
}

await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(path.join(RESULTS_DIR, 'a11y.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${RESULTS_DIR}/a11y.json`);

async function countTabStops(page: import('playwright').Page): Promise<number> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return `${el.tagName}:${el.textContent?.slice(0, 20)}:${el.className}`;
    });
    if (!id || seen.has(id)) break;
    seen.add(id);
  }
  return seen.size;
}
