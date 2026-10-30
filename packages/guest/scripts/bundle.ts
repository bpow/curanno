/**
 * Builds the self-contained guest bundle (`build/guest.js`, an IIFE the
 * bookmarklet injects) and the fake sidebar page script
 * (`build/fake-sidebar.js`). `build/` is separate from `dist/`, which holds
 * the compiled library. The model package is bundled from source so a stale
 * `dist/` can never leak into the guest.
 *
 *   pnpm --filter @curanno/guest bundle [--out-dir dir] [--no-minify] [--watch]
 */
import path from 'node:path';
import * as esbuild from 'esbuild';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
export const BUILD_DIR = path.join(PACKAGE_DIR, 'build');
const MODEL_ENTRY = path.resolve(PACKAGE_DIR, '../model/src/index.ts');

export interface BundleOptions {
  outDir?: string;
  minify?: boolean;
}

export interface BundleOutput {
  guest: string;
  fakeSidebar: string;
}

export function bundleConfig(options: BundleOptions = {}): esbuild.BuildOptions {
  const outDir = options.outDir ?? BUILD_DIR;
  return {
    entryPoints: {
      guest: path.join(PACKAGE_DIR, 'src/bundle.ts'),
      'fake-sidebar': path.join(PACKAGE_DIR, 'src/rpc/fake-sidebar-page.ts'),
    },
    bundle: true,
    format: 'iife',
    target: 'es2022',
    outdir: outDir,
    minify: options.minify ?? true,
    sourcemap: true,
    legalComments: 'inline',
    alias: { '@curanno/model': MODEL_ENTRY },
    logLevel: 'warning',
  };
}

export function bundleOutput(options: BundleOptions = {}): BundleOutput {
  const outDir = options.outDir ?? BUILD_DIR;
  return {
    guest: path.join(outDir, 'guest.js'),
    fakeSidebar: path.join(outDir, 'fake-sidebar.js'),
  };
}

export async function buildGuest(options: BundleOptions = {}): Promise<BundleOutput> {
  await esbuild.build(bundleConfig(options));
  return bundleOutput(options);
}

/** Rebuild on change; resolves to a function that stops watching. */
export async function watchGuest(options: BundleOptions = {}): Promise<() => Promise<void>> {
  const context = await esbuild.context(bundleConfig(options));
  await context.watch();
  return () => context.dispose();
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out-dir');
  const options: BundleOptions = {
    minify: !args.includes('--no-minify'),
    ...(outIndex >= 0 ? { outDir: path.resolve(args[outIndex + 1] ?? BUILD_DIR) } : {}),
  };
  if (args.includes('--watch')) {
    await watchGuest(options);
    console.log(`watching; bundles in ${options.outDir ?? BUILD_DIR}`);
  } else {
    const out = await buildGuest(options);
    console.log(`built ${out.guest} and ${out.fakeSidebar}`);
  }
}
