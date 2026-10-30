/**
 * Success criterion 6, as far as the guest is concerned: a hostile script
 * on the annotated page, present before the guest loads, hooks everything
 * it can and still sees no annotation body, token or sidebar DOM. The fake
 * sidebar holds known secrets (`FAKE_SECRETS`) for the test to look for.
 */
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAKE_SECRETS } from '../../src/rpc/fake-sidebar.ts';
import { injectGuest, selectText, startHarness, type Harness } from './harness.ts';

declare global {
  interface Window {
    __hostile: {
      seen: string[];
      attempts: Record<string, string>;
    };
  }
}

/** Installed before any page script: hooks message traffic and records everything it sees. */
const HOSTILE = `
  const seen = [];
  const attempts = {};
  const record = (what, value) => {
    try { seen.push(typeof value === 'string' ? value : JSON.stringify(value)); } catch { seen.push(String(value)); }
  };
  const hook = (object, method, label) => {
    const original = object[method];
    object[method] = function (...args) {
      record(label, args[0]);
      return original.apply(this, args);
    };
  };
  hook(MessagePort.prototype, 'postMessage', 'port.postMessage');
  hook(Window.prototype, 'postMessage', 'window.postMessage');
  const originalAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === 'message' && typeof listener === 'function') {
      const wrapped = function (event) {
        record('message', event.data);
        return listener.call(this, event);
      };
      return originalAdd.call(this, type, wrapped, options);
    }
    return originalAdd.call(this, type, listener, options);
  };
  window.addEventListener('message', (event) => record('window.message', event.data));
  window.__hostile = { seen, attempts };
`;

let h: Harness;
let page: Page;

beforeAll(async () => {
  h = await startHarness();
  page = await h.browser.newPage();
  await page.addInitScript(HOSTILE);
  await page.goto(`${h.host.origin}/cases/synth-overlap/original.html`);
  const sidebar = await injectGuest(h, page);
  // The sidebar has an annotation whose body it keeps to itself.
  await sidebar.evaluate(
    (source) =>
      window.__fakeSidebar.anchor([
        {
          id: 'urn:secret-annotation',
          target: {
            source,
            selector: [{ type: 'TextQuoteSelector', exact: 'Four members supported it' }],
          },
        },
      ]),
    `${h.host.origin}/cases/synth-overlap/original.html`,
  );
  await sidebar.waitForFunction(() => window.__fakeSidebar.anchoring.has('urn:secret-annotation'));
  await selectText(page, 'Two members supported it');
  await sidebar.waitForFunction(() => window.__fakeSidebar.selection !== null);
  await sidebar.evaluate(() => window.__fakeSidebar.focus(['urn:secret-annotation']));
  await sidebar.evaluate(() => window.__fakeSidebar.scrollTo('urn:secret-annotation'));
  await page.waitForTimeout(300);
});

afterAll(async () => {
  await h.close();
});

describe('a hostile host page', () => {
  it('cannot reach the sidebar document, storage or window state', async () => {
    const attempts = await page.evaluate(() => {
      const out: Record<string, string> = {};
      const attempt = (name: string, fn: () => unknown) => {
        try {
          out[name] = JSON.stringify(fn()) ?? 'undefined';
        } catch (err) {
          out[name] = `threw ${(err as Error).name}`;
        }
      };
      const host = document.querySelector('[data-curanno-guest="sidebar"]');
      attempt('iframes in light DOM', () => document.querySelectorAll('iframe').length);
      attempt('host shadowRoot', () => host?.shadowRoot);
      attempt('child windows', () => window.frames.length);
      // Whatever handle the page can get on the frame's window, if any.
      const frame = window.frames.length > 0 ? window.frames[0] : undefined;
      attempt('frame document', () => frame?.document.body.innerHTML);
      attempt('frame localStorage', () => frame?.localStorage.getItem('token'));
      attempt(
        'frame global',
        () => (frame as (Window & { __fakeSidebar?: unknown }) | undefined)?.__fakeSidebar,
      );
      attempt('guest global keys', () => Object.keys(window.__curannoGuest ?? {}));
      return out;
    });
    expect(attempts['iframes in light DOM']).toBe('0');
    expect(attempts['host shadowRoot']).toBe('null');
    // Either the page has no handle on the frame at all, or the handle is cross-origin.
    if (attempts['child windows'] === '0') {
      expect(attempts['frame document']).toBe('undefined');
    } else {
      expect(attempts['frame document']).toMatch(/^threw SecurityError/);
      expect(attempts['frame localStorage']).toMatch(/^threw SecurityError/);
    }
    expect(attempts['frame global']).toBe('undefined');
    expect(attempts['guest global keys']).toBe('["version","toggleSidebar","destroy"]');
  });

  it('sees no body or token in anything it hooked or can read', async () => {
    const observable = await page.evaluate(() => {
      const seen = window.__hostile.seen.join('\n');
      const dom = document.documentElement.outerHTML;
      const highlights = [...CSS.highlights.values()].flatMap((hl) => [...hl].map(String));
      let storage: string;
      try {
        storage = JSON.stringify({ ...localStorage, ...sessionStorage });
      } catch {
        storage = '';
      }
      return {
        seen,
        dom,
        highlights: highlights.join('\n'),
        storage,
        hooked: window.__hostile.seen.length,
      };
    });
    // The hooks worked: the page did observe the guest's own traffic.
    expect(observable.hooked).toBeGreaterThan(0);
    expect(observable.seen).toContain('anchoring.results');
    expect(observable.seen).toContain('selection.changed');
    for (const text of [
      observable.seen,
      observable.dom,
      observable.highlights,
      observable.storage,
    ]) {
      expect(text).not.toContain(FAKE_SECRETS.body);
      expect(text).not.toContain(FAKE_SECRETS.token);
      expect(text).not.toContain('fake-sidebar-token');
    }
  });

  it('cannot drive the guest through window messages', async () => {
    const before = await page.evaluate(() => CSS.highlights.get('curanno-annotation')?.size ?? 0);
    await page.evaluate(() => {
      window.postMessage(
        {
          protocol: 'curanno/guest-sidebar',
          version: 1,
          type: 'annotations.unanchor',
          ids: ['urn:secret-annotation'],
        },
        '*',
      );
      window.postMessage(
        { protocol: 'curanno/guest-sidebar', version: 1, type: 'sidebar.ready' },
        '*',
      );
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => CSS.highlights.get('curanno-annotation')?.size ?? 0)).toBe(
      before,
    );
    // The spoofed sidebar.ready from the page itself did not start a new connection.
    const sidebar = page.frames().find((f) => f.url().startsWith(h.sidebar.origin));
    expect(
      await sidebar?.evaluate(
        () => window.__fakeSidebar.messages.filter((m) => m.type === 'guest.hello').length,
      ),
    ).toBe(1);
  });
});
