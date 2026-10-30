/**
 * Shared setup for the browser tests: build the guest bundle and the test
 * runtimes, serve the host pages and the fake sidebar on two origins, and
 * launch Chromium.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { bookmarkletSource } from '../../src/bookmarklet.ts';
import { buildGuest } from '../../scripts/bundle.ts';
import { serve, type StaticServer } from '../../scripts/serve.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '../..');
export const BUILD_DIR = path.join(PACKAGE_DIR, 'test/.build');
export const CORPUS_DIR = path.join(PACKAGE_DIR, 'corpus');
export const FIXTURES_DIR = path.resolve(PACKAGE_DIR, '../model/fixtures/text-model');
const DEV_DIR = path.join(PACKAGE_DIR, 'dev');
const RUNTIME_DIR = path.join(PACKAGE_DIR, 'test/browser/runtime');
export const SIDEBAR_PATH = '/sidebar.html';

export interface Harness {
  browser: Browser;
  host: StaticServer;
  sidebar: StaticServer;
  bundleUrl: string;
  /** JavaScript that injects the guest as the bookmarklet would. */
  injectSource: string;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  await mkdir(BUILD_DIR, { recursive: true });
  await buildGuest({ outDir: BUILD_DIR, minify: false });
  await esbuild.build({
    entryPoints: [path.join(RUNTIME_DIR, 'fixtures-runtime.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    outdir: BUILD_DIR,
    alias: { '@curanno/model': path.resolve(PACKAGE_DIR, '../model/src/index.ts') },
    logLevel: 'warning',
  });
  const [host, sidebar] = await Promise.all([
    serve({
      host: '127.0.0.1',
      roots: [CORPUS_DIR, BUILD_DIR],
      pages: {
        '/blank.html': '<!doctype html><html><head><title>blank</title></head><body></body></html>',
      },
    }),
    serve({ host: 'localhost', roots: [DEV_DIR, BUILD_DIR] }),
  ]);
  const bundleUrl = `${sidebar.origin}/guest.js`;
  const browser = await chromium.launch();
  return {
    browser,
    host,
    sidebar,
    bundleUrl,
    injectSource: bookmarkletSource({
      bundleUrl,
      sidebarOrigin: sidebar.origin,
      sidebarPath: SIDEBAR_PATH,
    }),
    async close() {
      await browser.close();
      await Promise.all([host.close(), sidebar.close()]);
    },
  };
}

/** Inject the guest as the bookmarklet does and wait for the fake sidebar to connect. */
export async function injectGuest(h: Harness, page: Page): Promise<Frame> {
  await page.evaluate(h.injectSource);
  const frame = await waitForFrame(page, h.sidebar.origin);
  await frame.waitForFunction(() => window.__fakeSidebar?.guestId !== undefined);
  return frame;
}

export async function waitForFrame(page: Page, origin: string): Promise<Frame> {
  for (let i = 0; i < 200; i++) {
    const frame = page.frames().find((f) => f.url().startsWith(origin));
    if (frame) {
      await frame.waitForLoadState();
      return frame;
    }
    await page.waitForTimeout(25);
  }
  throw new Error(`no frame from ${origin}`);
}

/** Select text in the page by its first occurrence inside `root`. */
export async function selectText(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    throw new Error(`text not found: ${needle}`);
  }, text);
}
