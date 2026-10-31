/**
 * Success criterion 6 across the whole client: a hostile script on the
 * annotated page, present before the guest loads, hooks every message
 * channel it can reach and still sees no token, body, tag or creator. The
 * sidebar is signed in with a known token and shows an annotation with a
 * known body; the test creates another with a known comment, then looks
 * for all of them in everything the page could observe. It also checks the
 * embedding policy the sidebar is served with (ADR 0007, ADR 0019).
 */
import { expect, test, type Response } from '@playwright/test';
import { RPC_PROTOCOL, RPC_PROTOCOL_VERSION } from '@curanno/model';
import {
  HOST_ORIGIN,
  PAGE_PATH,
  PUBLIC_ANNOTATION_ID,
  SECRETS,
  SIDEBAR_URL,
  UNLISTED_ORIGIN,
  highlightCentre,
  highlightedTexts,
  injectGuest,
  injectSource,
  seedSession,
  selectText,
  stubApi,
} from './harness';

const PAGE_URL = `${HOST_ORIGIN}${PAGE_PATH}`;
const COMMENT = 'Secret comment typed into the sidebar: not for the page';

declare global {
  interface Window {
    __hostile: { seen: string[] };
  }
}

/** Installed before any page script on the host origin: hooks message traffic and records it. */
const HOSTILE = `
  if (location.origin === ${JSON.stringify(HOST_ORIGIN)} || location.origin === ${JSON.stringify(UNLISTED_ORIGIN)}) {
    const seen = [];
    const record = (value) => {
      try { seen.push(typeof value === 'string' ? value : JSON.stringify(value)); } catch { seen.push(String(value)); }
    };
    const hook = (object, method) => {
      const original = object[method];
      object[method] = function (...args) {
        record(args[0]);
        return original.apply(this, args);
      };
    };
    hook(MessagePort.prototype, 'postMessage');
    hook(Window.prototype, 'postMessage');
    const originalAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type === 'message' && typeof listener === 'function') {
        const wrapped = function (event) {
          record(event.data);
          return listener.call(this, event);
        };
        return originalAdd.call(this, type, wrapped, options);
      }
      return originalAdd.call(this, type, listener, options);
    };
    window.addEventListener('message', (event) => record(event.data));
    window.__hostile = { seen };
  }
`;

/** Keys that would carry what the protocol must not: none may appear in anything the page saw. */
const FORBIDDEN_KEYS = new Set(['body', 'bodyValue', 'creator', 'tags', 'token', 'authorization']);

function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

test('a hostile page observes the traffic but never a token, body, tag or creator', async ({
  context,
}) => {
  await seedSession(context);
  await context.addInitScript(HOSTILE);
  await stubApi(context, PAGE_URL);
  const page = await context.newPage();
  const responses: Response[] = [];
  page.on('response', (r) => {
    if (r.url() === SIDEBAR_URL) responses.push(r);
  });
  await page.goto(PAGE_URL);
  const sidebar = await injectGuest(page);

  // Exercise every direction of the protocol while the hooks are listening.
  const card = sidebar.locator('article.card');
  await expect(card).toContainText(SECRETS.body);
  await expect.poll(() => highlightedTexts(page)).toHaveLength(1);
  await selectText(page, 'Two members supported it');
  await sidebar.getByRole('button', { name: 'Annotate selection' }).click();
  await sidebar.getByLabel('Comment').fill(COMMENT);
  await sidebar.getByRole('button', { name: 'Post' }).click();
  await expect(sidebar.locator('article.card')).toHaveCount(2);
  await expect.poll(() => highlightedTexts(page)).toHaveLength(2);
  await card.first().hover();
  await sidebar.locator('article.card blockquote').first().click();
  const at = await highlightCentre(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);

  // The embedding policy: served as a header, listing the host origins, with no X-Frame-Options.
  const frameResponse = responses[0];
  expect(frameResponse).toBeDefined();
  const headers = frameResponse!.headers();
  expect(headers['content-security-policy']).toMatch(/frame-ancestors/);
  expect(headers['content-security-policy']).toContain('http://127.0.0.1:*');
  expect(headers['x-frame-options']).toBeUndefined();

  const observable = await page.evaluate(() => {
    const seen = window.__hostile.seen;
    let storage = '';
    try {
      storage = JSON.stringify({ ...localStorage, ...sessionStorage });
    } catch {
      // unavailable storage is fine
    }
    return {
      seen,
      dom: document.documentElement.outerHTML,
      highlights: [...CSS.highlights.values()].flatMap((hl) => [...hl].map(String)).join('\n'),
      storage,
      iframes: document.querySelectorAll('iframe').length,
      shadow: document.querySelector('[data-curanno-guest="sidebar"]')?.shadowRoot ?? null,
    };
  });

  // The hooks worked: the page did observe the protocol in both directions.
  // (`guest.connect` goes through the frame's cross-origin `postMessage`,
  // which the page's hook on its own `Window.prototype` does not see.)
  const joined = observable.seen.join('\n');
  for (const type of [
    'sidebar.ready',
    'guest.hello',
    'sidebar.hello',
    'document.report',
    'annotations.anchor',
    'anchoring.results',
    'selection.changed',
    'selection.clear',
    'highlights.focus',
    'highlights.hovered',
    'highlights.activated',
    'scroll.to',
  ]) {
    expect(joined, `the page should have seen ${type}`).toContain(type);
  }

  // Nothing but IRIs and selectors crossed: no forbidden key in any message, no secret anywhere.
  for (const line of observable.seen) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    const keys = keysOf(parsed);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key), `key ${key} in ${line}`).toBe(false);
  }
  for (const text of [joined, observable.dom, observable.highlights, observable.storage]) {
    expect(text).not.toContain(SECRETS.token);
    expect(text).not.toContain(SECRETS.body);
    expect(text).not.toContain(SECRETS.tag);
    expect(text).not.toContain(SECRETS.creator);
    expect(text).not.toContain(COMMENT);
    expect(text).not.toContain('Bearer ');
  }
  expect(observable.iframes).toBe(0);
  expect(observable.shadow).toBeNull();
});

test('a page on an origin outside frame-ancestors cannot embed the sidebar', async ({
  context,
}) => {
  await seedSession(context);
  await context.addInitScript(HOSTILE);
  await stubApi(context, `${UNLISTED_ORIGIN}${PAGE_PATH}`);
  const page = await context.newPage();
  await page.goto(`${UNLISTED_ORIGIN}${PAGE_PATH}`);
  await page.evaluate(injectSource(`${UNLISTED_ORIGIN}/guest.js`));
  await page.waitForTimeout(2000);
  // The browser refused the frame, so the sidebar never ran and nothing connected.
  const seen = await page.evaluate(() => window.__hostile.seen.join('\n'));
  expect(seen).not.toContain('sidebar.ready');
  expect(seen).not.toContain('guest.hello');
  expect(await highlightedTexts(page)).toEqual([]);
});

/**
 * The relay attack from the 2026-10-30 review (ADR 0024): the page catches
 * `sidebar.ready`, which hands it the sidebar's window as the event source,
 * and posts its own `guest.connect` claiming to relay a frame of another
 * origin. The sidebar must hold that guest to the page's own origin.
 */
const VICTIM_URL = 'https://victim.test/private.html';
const VICTIM_QUOTE = 'Victim quote: only for pages on victim.test';
const FORGER = `
  if (location.origin === ${JSON.stringify(HOST_ORIGIN)}) {
    const forged = { received: [], tried: false };
    window.__forged = forged;
    const envelope = (payload) => ({ protocol: ${JSON.stringify(RPC_PROTOCOL)}, version: ${RPC_PROTOCOL_VERSION}, ...payload });
    window.addEventListener('message', (event) => {
      if (forged.tried || event.data?.type !== 'sidebar.ready' || !event.source) return;
      forged.tried = true;
      // After the real guest, whose connect from this same window would replace the forged one.
      setTimeout(() => forge(event.source), 500);
    });
    const forge = (sidebar) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => forged.received.push(JSON.stringify(e.data));
      sidebar.postMessage(
        envelope({ type: 'guest.connect', guestId: 'forged', frameOrigin: 'https://victim.test' }),
        '*',
        [channel.port2],
      );
      channel.port1.postMessage(envelope({ type: 'guest.hello', guestId: 'forged', capabilities: { highlights: 'css-highlight' } }));
      channel.port1.postMessage(envelope({
        type: 'document.report',
        document: { uri: ${JSON.stringify(VICTIM_URL)}, links: [{ uri: ${JSON.stringify(VICTIM_URL)}, relation: 'self' }] },
      }));
    };
  }
`;

test('a hostile page cannot pass itself off as a frame of another origin', async ({ context }) => {
  await seedSession(context);
  await context.addInitScript(FORGER);
  const api = await stubApi(context, PAGE_URL);
  api.annotations.set(`${PUBLIC_ANNOTATION_ID.slice(0, -1)}2`, {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: `${PUBLIC_ANNOTATION_ID.slice(0, -1)}2`,
    type: 'Annotation',
    created: '2026-10-30T08:00:00Z',
    modified: '2026-10-30T08:00:00Z',
    permissions: ['read'],
    body: { type: 'TextualBody', value: 'Private note on the victim page' },
    target: {
      type: 'SpecificResource',
      source: VICTIM_URL,
      selector: [{ type: 'TextQuoteSelector', exact: VICTIM_QUOTE }],
    },
  });
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await injectGuest(page);

  const received = (): Promise<string[]> =>
    page.evaluate(
      () => (window as unknown as { __forged: { received: string[] } }).__forged.received,
    );
  await expect
    .poll(received)
    .toEqual(expect.arrayContaining([expect.stringContaining('may not report')]));
  await page.waitForTimeout(1500);
  const all = (await received()).join('\n');
  expect(all).not.toContain('annotations.anchor');
  expect(all).not.toContain(VICTIM_QUOTE);
  expect(
    api.calls.filter((c) => c.url.searchParams.get('uri') === VICTIM_URL),
    'the sidebar never looked the victim page up',
  ).toEqual([]);
});
