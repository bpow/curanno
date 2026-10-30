/**
 * Renders `corpus/cases/<id>/src/<name>.html` to `corpus/cases/<id>/<name>.pdf`
 * with Chromium, so PDF cases have real edit histories. Run it only when a
 * source changes; the PDFs are committed.
 *
 *   pnpm --filter @curanno/guest corpus:pdf
 */
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CASES_DIR } from './corpus.ts';
import { launch } from './page.ts';

const browser = await launch();
try {
  const page = await browser.newPage();
  for await (const rel of glob('*/src/*.html', { cwd: CASES_DIR })) {
    const src = path.join(CASES_DIR, rel);
    const out = path.join(path.dirname(path.dirname(src)), path.basename(src, '.html') + '.pdf');
    await page.goto(pathToFileURL(src).href, { waitUntil: 'load' });
    await page.pdf({
      path: out,
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      printBackground: true,
    });
    console.log(`${rel} -> ${path.relative(CASES_DIR, out)}`);
  }
} finally {
  await browser.close();
}
