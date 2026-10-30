/**
 * Authoring tool: fills in `selectors` for every annotation of every case
 * from its `select` against the original variant, and writes case.json
 * back. Pass case ids to limit it; `--force` regenerates existing selectors.
 *
 *   pnpm --filter @curanno/guest corpus:describe [--force] [case-id ...]
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from './build.ts';
import { CASES_DIR, loadCases, type Case } from './corpus.ts';
import { launch, openVariant, rootSelector } from './page.ts';
import { startServer } from './server.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const ids = args.filter((a) => !a.startsWith('--'));

await build();
const server = await startServer();
const browser = await launch();
try {
  for (const c of await loadCases(ids)) {
    // An annotation that must not match even on the original carries
    // hand-written selectors (the PLOS decoy) and cannot be described.
    const handWritten = (a: (typeof c.annotations)[number]): boolean =>
      a.expected?.['original'] !== undefined && 'mustNotMatch' in a.expected['original'];
    const todo = c.annotations.filter((a) => !handWritten(a) && (force || !a.selectors));
    if (todo.length === 0) continue;
    const original = c.variants.find((v) => v.id === 'original')!;
    const page = await openVariant(browser, c, original, server.origin);
    for (const a of todo) {
      const result = await page.evaluate(
        ([root, select]) => window.__trial.describe(root, select),
        [rootSelector(c), a.select] as const,
      );
      if (a.notAnnotatable) {
        if (result) throw new Error(`${c.id}/${a.id} is marked notAnnotatable but was described`);
        delete a.selectors;
        console.log(`${c.id}/${a.id}: not annotatable`);
        continue;
      }
      if (!result) throw new Error(`${c.id}/${a.id}: the selection covers no text of the root`);
      a.selectors = result.selectors;
      console.log(
        `${c.id}/${a.id}: ${result.span.start}-${result.span.end} ${JSON.stringify(result.exact.slice(0, 40))}`,
      );
    }
    await page.close();
    await writeCase(c);
  }
} finally {
  await browser.close();
  await server.close();
}

async function writeCase(c: Case): Promise<void> {
  // Keep key order stable so diffs stay readable.
  const ordered: Case = {
    id: c.id,
    title: c.title,
    kind: c.kind,
    source: c.source,
    tags: c.tags,
    ...(c.root ? { root: c.root } : {}),
    variants: c.variants,
    annotations: c.annotations.map((a) => ({
      id: a.id,
      description: a.description,
      ...(a.partOf ? { partOf: a.partOf } : {}),
      select: a.select,
      ...(a.notAnnotatable ? { notAnnotatable: true } : {}),
      ...(a.expected ? { expected: a.expected } : {}),
      ...(a.selectors ? { selectors: a.selectors } : {}),
    })),
  };
  await writeFile(path.join(CASES_DIR, c.id, 'case.json'), JSON.stringify(ordered, null, 2) + '\n');
}
