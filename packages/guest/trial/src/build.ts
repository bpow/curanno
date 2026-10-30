/**
 * Bundles the in-page runtime (candidates plus helpers), the PDF text-layer
 * page and any framework apps that corpus cases ship as source. Output goes
 * to `trial/.build`, which the static server overlays on the corpus.
 */
import { cp, glob, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { CASES_DIR } from './corpus.ts';

export const BUILD_DIR = path.resolve(import.meta.dirname, '../.build');
const STATIC_DIR = path.resolve(import.meta.dirname, '../static');
const PDFJS_DIR = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

export async function build(): Promise<void> {
  await mkdir(path.join(BUILD_DIR, '__trial/pdfjs'), { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(import.meta.dirname, 'browser/index.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    outfile: path.join(BUILD_DIR, '__trial/runtime.js'),
    loader: { '.css': 'text' },
    logLevel: 'warning',
  });

  await esbuild.build({
    entryPoints: [path.join(import.meta.dirname, 'browser/pdf-view.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: path.join(BUILD_DIR, '__trial/pdf-view.js'),
    logLevel: 'warning',
  });

  await cp(path.join(STATIC_DIR, 'pdf-view.html'), path.join(BUILD_DIR, '__trial/pdf-view.html'));
  await cp(
    path.join(PDFJS_DIR, 'build/pdf.worker.mjs'),
    path.join(BUILD_DIR, '__trial/pdfjs/pdf.worker.mjs'),
  );
  await cp(
    path.join(PDFJS_DIR, 'web/pdf_viewer.css'),
    path.join(BUILD_DIR, '__trial/pdfjs/pdf_viewer.css'),
  );

  const apps: string[] = [];
  for await (const entry of glob('*/app.{ts,tsx}', { cwd: CASES_DIR })) apps.push(entry);
  if (apps.length > 0) {
    await esbuild.build({
      entryPoints: apps.map((a) => path.join(CASES_DIR, a)),
      bundle: true,
      format: 'iife',
      target: 'es2022',
      outdir: path.join(BUILD_DIR, 'cases'),
      outbase: CASES_DIR,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      logLevel: 'warning',
    });
  }
}

if (process.argv[1] === import.meta.filename) {
  await build();
  console.log(`built into ${BUILD_DIR}`);
}
