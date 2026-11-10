/**
 * The extension in Chromium against the guest's fake sidebar: pages with
 * strict CSPs, a cross-origin frame, navigation in a tab where the guest
 * is on, the PDF redirect, both badge counts, the sidebar's sign-in bridge
 * and the options page. The
 * toolbar button is pressed by dispatching its click event in the worker.
 */
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium, type BrowserContext, type Frame, type Page, type Worker } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXTENSION_BRIDGE, type BridgeMessage, type GuestMessage } from '@curanno/model';
import type { FakeSidebar } from '../../../../packages/guest/src/rpc/fake-sidebar.ts';
import { buildGuest } from '../../../../packages/guest/scripts/bundle.ts';
import { serve, type StaticServer } from '../../../../packages/guest/scripts/serve.ts';
import { buildExtension } from '../../scripts/build.ts';
import type { Settings } from '../../src/settings.ts';

declare global {
  interface Window {
    __fakeSidebar: FakeSidebar;
  }
}

const PACKAGE_DIR = path.resolve(import.meta.dirname, '../..');
const BUILD_DIR = path.join(PACKAGE_DIR, 'test/.build');
const GUEST_DIR = path.resolve(PACKAGE_DIR, '../../packages/guest');
const PDF_FILE = path.join(GUEST_DIR, 'corpus/cases/pdf-generated-report/original.pdf');

interface Route {
  body: string | Buffer;
  type?: string;
  csp?: string;
}

interface Site {
  origin: string;
  requests: http.IncomingMessage[];
  close(): Promise<void>;
}

/** A server of fixed routes, each with its own content type and CSP. */
async function site(routes: (origin: string) => Record<string, Route>): Promise<Site> {
  const requests: http.IncomingMessage[] = [];
  let table: Record<string, Route> = {};
  const server = http.createServer((req, res) => {
    requests.push(req);
    const url = new URL(req.url ?? '/', 'http://x');
    // A provider that signs everyone in at once: back to redirect_uri with a code.
    if (url.pathname === '/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', 'the-code');
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.href }).end();
      return;
    }
    const route = table[url.pathname];
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': route.type ?? 'text/html; charset=utf-8',
      ...(route.csp ? { 'content-security-policy': route.csp } : {}),
    });
    res.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  table = routes(origin);
  return {
    origin,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;

let sidebar: StaticServer;
let child: Site;
let pages: Site;
let viewer: Site;
let api: Site;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;

async function configure(settings: Partial<Settings>): Promise<void> {
  await worker.evaluate(async (s) => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(s);
  }, settings);
}

async function tabId(url: string): Promise<number> {
  return worker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    if (tab?.id === undefined) throw new Error(`no tab at ${u}`);
    return tab.id;
  }, url);
}

async function press(url: string): Promise<void> {
  const id = await tabId(url);
  await worker.evaluate(async (i) => {
    // `dispatch` exists on extension events but is not in their types.
    const clicked = chrome.action.onClicked as unknown as { dispatch(tab: chrome.tabs.Tab): void };
    clicked.dispatch(await chrome.tabs.get(i));
  }, id);
}

async function badge(url: string): Promise<string> {
  const id = await tabId(url);
  return worker.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), id);
}

async function waitForBadge(url: string, text: string): Promise<void> {
  await expect.poll(() => badge(url), { timeout: 10_000 }).toBe(text);
}

async function sidebarFrame(p: Page): Promise<Frame> {
  await expect
    .poll(() => p.frames().some((f) => f.url().startsWith(sidebar.origin)), { timeout: 10_000 })
    .toBe(true);
  const frame = p.frames().find((f) => f.url().startsWith(sidebar.origin)) as Frame;
  await frame.waitForFunction(() => window.__fakeSidebar?.guestId !== undefined);
  return frame;
}

function reported(frame: Frame): Promise<string[]> {
  return frame.evaluate(() =>
    window.__fakeSidebar.messages
      .filter((m: GuestMessage) => m.type === 'document.report')
      .map((m) => (m.type === 'document.report' ? m.document.uri : '')),
  );
}

async function open(url: string): Promise<Page> {
  const p = await context.newPage();
  await p.goto(url);
  return p;
}

beforeAll(async () => {
  const guestBuild = path.join(BUILD_DIR, 'guest');
  await buildGuest({ outDir: guestBuild, minify: false });
  const extensionDir = await buildExtension({
    outDir: path.join(BUILD_DIR, 'extension'),
    minify: false,
  });
  child = await site(() => ({
    '/child.html': {
      body: page('child', '<p>Text inside a cross-origin frame.</p>'),
      csp: "default-src 'none'; frame-src 'none'",
    },
  }));
  // A sidebar that frames another origin, as the real one frames the identity provider.
  const fake = await readFile(path.join(GUEST_DIR, 'dev/sidebar.html'), 'utf8');
  const script = '<script src="/fake-sidebar.js"></script>';
  sidebar = await serve({
    host: 'localhost',
    roots: [path.join(GUEST_DIR, 'dev'), guestBuild],
    pages: {
      '/nested-sidebar.html': fake.replace(
        script,
        `<iframe src="${child.origin}/child.html"></iframe>${script}`,
      ),
    },
  });
  const pdf = await readFile(PDF_FILE);
  pages = await site(() => ({
    '/strict.html': {
      body: page('strict', '<p>A page whose policy allows no scripts and no frames.</p>'),
      csp: "default-src 'none'; script-src 'none'; frame-src 'none'",
    },
    '/framed.html': {
      body: page('framed', `<p>Host text.</p><iframe src="${child.origin}/child.html"></iframe>`),
      csp: `default-src 'none'; frame-src ${child.origin}`,
    },
    '/second.html': { body: page('second', '<p>Another page in the same tab.</p>') },
    '/doc.pdf': { body: pdf, type: 'application/pdf' },
    '/download.pdf': { body: pdf, type: 'application/pdf' },
  }));
  viewer = await site(() => ({ '/pdf/': { body: page('viewer', '<p>Viewer</p>') } }));
  api = await site(() => ({
    '/x/search': { body: JSON.stringify({ total: 7, items: [] }), type: 'application/json' },
  }));
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

afterAll(async () => {
  await context?.close();
  await Promise.all([sidebar, child, pages, viewer, api].map((s) => s?.close()));
});

describe('the toolbar button', () => {
  it('runs the guest and frames the sidebar on a page that blocks scripts and frames', async () => {
    await configure({ sidebarUrl: `${sidebar.origin}/sidebar.html`, pdfViewerUrl: '' });
    const url = `${pages.origin}/strict.html`;
    const p = await open(url);
    await press(url);
    const frame = await sidebarFrame(p);
    await expect.poll(() => reported(frame)).toContain(url);
    expect(await worker.evaluate(() => chrome.action.getTitle({}))).toBe('CurAnno: off');

    await press(url);
    await expect.poll(() => p.frames().some((f) => f.url().startsWith(sidebar.origin))).toBe(false);
    await p.close();
  });

  it('connects a cross-origin frame’s guest through the host', async () => {
    await configure({ sidebarUrl: `${sidebar.origin}/sidebar.html`, pdfViewerUrl: '' });
    const url = `${pages.origin}/framed.html`;
    const p = await open(url);
    await press(url);
    const frame = await sidebarFrame(p);
    // The fake sidebar keeps one guest's port at a time, so the host's own
    // report may be cut off by the child's; the first test covers the host.
    await expect
      .poll(() => reported(frame), { timeout: 10_000 })
      .toContain(`${child.origin}/child.html`);
    await p.close();
  });

  it('stays on across navigation in the tab, and counts anchored annotations', async () => {
    await configure({ sidebarUrl: `${sidebar.origin}/sidebar.html`, pdfViewerUrl: '' });
    const first = `${pages.origin}/strict.html`;
    const second = `${pages.origin}/second.html`;
    const p = await open(first);
    await press(first);
    await sidebarFrame(p);
    await p.goto(second);
    const frame = await sidebarFrame(p);
    await frame.evaluate((source) => {
      window.__fakeSidebar.anchor([
        {
          id: 'urn:a1',
          target: { source, selector: [{ type: 'TextQuoteSelector', exact: 'Another page' }] },
        },
        {
          id: 'urn:a2',
          target: { source, selector: [{ type: 'TextQuoteSelector', exact: 'same tab' }] },
        },
      ]);
    }, second);
    await waitForBadge(second, '2');
    await frame.waitForFunction(() => window.__fakeSidebar.anchoring.size === 2);
    expect(
      await frame.evaluate(() => [...window.__fakeSidebar.anchoring.values()].map((r) => r.state)),
    ).toEqual(['anchored', 'anchored']);
    // The isolated world draws into the document's one highlight registry.
    expect(await p.evaluate(() => CSS.highlights.size)).toBeGreaterThan(0);
    await frame.evaluate(() => window.__fakeSidebar.unanchor(['urn:a1']));
    await waitForBadge(second, '1');
    await press(second);
    await waitForBadge(second, '');
    await p.close();
  });

  it('leaves frames inside the sidebar alone', async () => {
    await configure({ sidebarUrl: `${sidebar.origin}/nested-sidebar.html`, pdfViewerUrl: '' });
    const url = `${pages.origin}/second.html`;
    const p = await open(url);
    await press(url);
    const frame = await sidebarFrame(p);
    await expect.poll(() => reported(frame)).toContain(url);
    // Longer than a sub-frame guest's discovery interval.
    await p.waitForTimeout(2500);
    expect(await reported(frame)).toEqual([url]);
    await p.close();
  });
});

describe('the sign-in bridge', () => {
  /** Runs in the sidebar frame's own world, as the sidebar does. */
  function ask(frame: Frame, message: BridgeMessage, answer: string): Promise<BridgeMessage> {
    return frame.evaluate(
      ([m, a]) =>
        new Promise<BridgeMessage>((resolve) => {
          window.addEventListener('message', (event) => {
            const data = event.data as BridgeMessage;
            if (event.source === window && data?.bridge === m.bridge && data.type === a) {
              resolve(data);
            }
          });
          window.postMessage(m, location.origin);
        }),
      [message, answer] as const,
    );
  }

  it('has a fixed extension id, so its redirect URI can be registered', () => {
    expect(extensionId).toBe('dmlkjhnoiinndnkboiknehimngilddpp');
  });

  it('runs a sign-in for the sidebar frame and hands back where the provider sent it', async () => {
    await configure({ sidebarUrl: `${sidebar.origin}/sidebar.html`, pdfViewerUrl: '' });
    const url = `${pages.origin}/second.html`;
    const p = await open(url);
    await press(url);
    const frame = await sidebarFrame(p);
    const redirectUri = `https://${extensionId}.chromiumapp.org/`;
    await expect
      .poll(() => ask(frame, { bridge: EXTENSION_BRIDGE, type: 'query' }, 'ready'))
      .toEqual({ bridge: EXTENSION_BRIDGE, type: 'ready', redirectUri });

    const authorize = new URL(`${child.origin}/authorize`);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', 's1');
    const navigate = { bridge: EXTENSION_BRIDGE, type: 'navigate', id: 'n1', url: authorize.href };
    const navigated = await ask(frame, navigate as BridgeMessage, 'navigated');
    expect(navigated).toEqual({
      bridge: EXTENSION_BRIDGE,
      type: 'navigated',
      id: 'n1',
      url: `${redirectUri}?code=the-code&state=s1`,
    });
    await p.close();
  });
});

describe('PDFs', () => {
  it('sends a PDF opened in a tab where the guest is on to the viewer', async () => {
    await configure({
      sidebarUrl: `${sidebar.origin}/sidebar.html`,
      pdfViewerUrl: `${viewer.origin}/pdf/`,
    });
    const start = `${pages.origin}/second.html`;
    const p = await open(start);
    await press(start);
    await sidebarFrame(p);
    await p.goto(`${pages.origin}/doc.pdf`).catch(() => undefined);
    await p.waitForURL((u) => u.origin === viewer.origin, { timeout: 10_000 });
    expect(new URL(p.url()).searchParams.get('file')).toBe(`${pages.origin}/doc.pdf`);
    // The viewer builds its own guest in, so the extension leaves it alone.
    await p.waitForTimeout(500);
    expect(p.frames().some((f) => f.url().startsWith(sidebar.origin))).toBe(false);
    await p.close();
  });

  it('sends a PDF tab to the viewer when the button is pressed there', async () => {
    await configure({
      sidebarUrl: `${sidebar.origin}/sidebar.html`,
      pdfViewerUrl: `${viewer.origin}/pdf/`,
    });
    const url = `${pages.origin}/download.pdf`;
    const p = await open(url);
    await press(url);
    await p.waitForURL((u) => u.origin === viewer.origin, { timeout: 10_000 });
    expect(new URL(p.url()).searchParams.get('file')).toBe(url);
    await p.close();
  });
});

describe('public counts', () => {
  it('shows nothing and asks nothing until they are turned on', async () => {
    await configure({ sidebarUrl: `${sidebar.origin}/sidebar.html`, apiUrl: api.origin });
    const before = api.requests.length;
    const url = `${pages.origin}/second.html`;
    const p = await open(url);
    await p.waitForTimeout(500);
    expect(await badge(url)).toBe('');
    expect(api.requests.length).toBe(before);
    await p.close();
  });

  it('shows the public total for a page while the guest is off, without credentials', async () => {
    await configure({
      sidebarUrl: `${sidebar.origin}/sidebar.html`,
      apiUrl: api.origin,
      publicCounts: true,
    });
    const url = `${pages.origin}/second.html`;
    const p = await open(url);
    await waitForBadge(url, '7');
    const request = api.requests.at(-1) as http.IncomingMessage;
    expect(new URL(request.url ?? '', api.origin).searchParams.get('uri')).toBe(url);
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.authorization).toBeUndefined();
    await p.close();
  });
});

describe('the options page', () => {
  it('refuses unusable values and saves good ones', async () => {
    await configure({});
    const p = await open(`chrome-extension://${extensionId}/options.html`);
    await expect.poll(() => p.inputValue('#sidebarUrl')).toBe('http://localhost:3001/sidebar/');
    await p.fill('#sidebarUrl', 'javascript:alert(1)');
    await p.click('button[type=submit]');
    await expect.poll(() => p.textContent('#sidebarUrl-error')).toMatch(/http/);
    expect(await worker.evaluate(() => chrome.storage.sync.get('sidebarUrl'))).toEqual({});

    await p.fill('#sidebarUrl', 'https://curanno.example/sidebar/');
    await p.check('#publicCounts');
    await p.click('button[type=submit]');
    await expect.poll(() => p.textContent('#status')).toMatch(/Saved/);
    expect(await worker.evaluate(() => chrome.storage.sync.get(null))).toMatchObject({
      sidebarUrl: 'https://curanno.example/sidebar/',
      publicCounts: true,
    });
    await p.close();
  });
});
