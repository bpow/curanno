/**
 * Builds the unpacked extension into `dist/`: the service worker, the
 * content script and the options page bundled with esbuild, the manifest
 * with the package's version, and the icons. The guest and the model are
 * bundled from source, as in the guest's own bundle, so a stale `dist/` of
 * either never leaks in.
 *
 *   pnpm --filter @curanno/extension build [--out-dir dir] [--no-minify] [--watch]
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { ICON_SIZES, ICON_STATES, iconPng } from './icons.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const SRC = path.join(PACKAGE_DIR, 'src');
export const DIST_DIR = path.join(PACKAGE_DIR, 'dist');

export interface BuildOptions {
  outDir?: string;
  minify?: boolean;
}

function esbuildConfig(outDir: string, minify: boolean): esbuild.BuildOptions {
  return {
    entryPoints: {
      background: path.join(SRC, 'background.ts'),
      content: path.join(SRC, 'content.ts'),
      options: path.join(SRC, 'options.ts'),
    },
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    outdir: outDir,
    minify,
    sourcemap: true,
    legalComments: 'inline',
    alias: {
      '@curanno/guest': path.resolve(PACKAGE_DIR, '../../packages/guest/src/index.ts'),
      '@curanno/model': path.resolve(PACKAGE_DIR, '../../packages/model/src/index.ts'),
    },
    logLevel: 'warning',
  };
}

async function writeStatic(outDir: string): Promise<void> {
  const pkg = JSON.parse(await readFile(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
    version: string;
  };
  const manifest = JSON.parse(await readFile(path.join(SRC, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  manifest['version'] = pkg.version;
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await copyFile(path.join(SRC, 'options.html'), path.join(outDir, 'options.html'));
  await mkdir(path.join(outDir, 'icons'), { recursive: true });
  for (const state of ICON_STATES) {
    for (const size of ICON_SIZES) {
      await writeFile(path.join(outDir, 'icons', `${state}-${size}.png`), iconPng(state, size));
    }
  }
}

/** Build the extension; resolves to the directory to load unpacked. */
export async function buildExtension(options: BuildOptions = {}): Promise<string> {
  const outDir = options.outDir ?? DIST_DIR;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await esbuild.build(esbuildConfig(outDir, options.minify ?? true));
  await writeStatic(outDir);
  return outDir;
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out-dir');
  const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1] ?? DIST_DIR) : DIST_DIR;
  const minify = !args.includes('--no-minify');
  if (args.includes('--watch')) {
    await buildExtension({ outDir, minify });
    const context = await esbuild.context(esbuildConfig(outDir, minify));
    await context.watch();
    console.log(`watching; load ${outDir} unpacked and reload it after changes`);
  } else {
    console.log(`built ${await buildExtension({ outDir, minify })}`);
  }
}
