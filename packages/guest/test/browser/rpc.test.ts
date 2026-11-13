/**
 * The guest talking to the fake sidebar across two real origins: the
 * bookmarklet injection, the handshake, document report, anchoring,
 * highlights, selection, re-anchoring after DOM changes, focus, scroll,
 * clicks and teardown.
 */
import type { AnchoringResult, GuestMessage } from '@curanno/model';
import type { Frame, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { injectGuest, selectText, startHarness, type Harness } from './harness.ts';

let h: Harness;
let page: Page;
let sidebar: Frame;

const PAGE_URL = () => `${h.host.origin}/cases/synth-overlap/original.html`;

async function messages(type: GuestMessage['type']): Promise<GuestMessage[]> {
  return sidebar.evaluate((t) => window.__fakeSidebar.messages.filter((m) => m.type === t), type);
}

async function results(): Promise<AnchoringResult[]> {
  return sidebar.evaluate(() => [...window.__fakeSidebar.anchoring.values()]);
}

async function highlightedTexts(): Promise<string[]> {
  return page.evaluate(() =>
    [...(CSS.highlights.get('curanno-annotation') ?? [])].map((r) => (r as Range).toString()),
  );
}

async function anchorQuote(
  id: string,
  exact: string,
  context: { prefix?: string; suffix?: string } = {},
) {
  await sidebar.evaluate(
    ([id, exact, context, source]) =>
      window.__fakeSidebar.anchor([
        {
          id,
          target: {
            source,
            selector: [{ type: 'TextQuoteSelector', exact, ...context }],
          },
        },
      ]),
    [id, exact, context, PAGE_URL()] as const,
  );
  await sidebar.waitForFunction((id) => window.__fakeSidebar.anchoring.has(id), id);
}

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  page = await h.browser.newPage();
  await page.goto(PAGE_URL());
  sidebar = await injectGuest(h, page);
});

afterEach(async () => {
  await page.close();
});

describe('guest and fake sidebar', () => {
  it('connects, reports the document and is injected only once', async () => {
    const hello = await messages('guest.hello');
    expect(hello).toHaveLength(1);
    expect(hello[0]).toMatchObject({ capabilities: { highlights: 'css-highlight' } });
    await sidebar.waitForFunction(() => window.__fakeSidebar.document !== undefined);
    const doc = await sidebar.evaluate(() => window.__fakeSidebar.document);
    expect(doc?.uri).toBe(PAGE_URL());
    expect(doc?.links[0]).toEqual({ uri: PAGE_URL(), relation: 'self' });
    expect(await page.evaluate(() => typeof window.__curannoGuest?.toggleSidebar)).toBe('function');

    // A second injection toggles the sidebar instead of loading again.
    await page.evaluate(h.injectSource);
    await sidebar.waitForFunction(() => window.__fakeSidebar.sidebarOpen === false);
    expect(page.frames().filter((f) => f.url().startsWith(h.sidebar.origin))).toHaveLength(1);
    expect(
      await page.evaluate(() => document.querySelectorAll('script[data-sidebar-origin]').length),
    ).toBe(1);
    await page.evaluate(h.injectSource);
    await sidebar.waitForFunction(() => window.__fakeSidebar.sidebarOpen === true);
  });

  it('anchors requests, draws highlights carrying ids only, and reports orphans', async () => {
    await anchorQuote('urn:a1', 'Four members supported it');
    await anchorQuote('urn:gone', 'this text is nowhere on the page at all');
    await anchorQuote('urn:twice', 'Proposal B');
    const all = await results();
    expect(all.find((r) => r.id === 'urn:a1')).toMatchObject({
      state: 'anchored',
      targets: [{ state: 'anchored', via: 'quote' }],
    });
    expect(all.find((r) => r.id === 'urn:gone')).toMatchObject({ state: 'orphaned' });
    // "Proposal B" is a heading and a sentence start: two equal candidates (ADR 0010).
    expect(all.find((r) => r.id === 'urn:twice')).toMatchObject({ state: 'ambiguous' });
    expect(await highlightedTexts()).toEqual(['Four members supported it']);
    // Nothing of the annotation but its id reached the page, and no text node was touched.
    const pageHtml = await page.content();
    expect(pageHtml).not.toContain('urn:a1');
    expect(
      await page.evaluate(() => document.querySelectorAll('mark, [data-annotation-id]').length),
    ).toBe(0);
  });

  it('removes highlights on unanchor and emphasises on focus', async () => {
    await anchorQuote('urn:a1', 'Four members supported it');
    await sidebar.evaluate(() => window.__fakeSidebar.focus(['urn:a1']));
    await page.waitForFunction(
      () => (CSS.highlights.get('curanno-annotation-focus')?.size ?? 0) === 1,
    );
    await sidebar.evaluate(() => window.__fakeSidebar.unanchor(['urn:a1']));
    await page.waitForFunction(() => (CSS.highlights.get('curanno-annotation')?.size ?? 0) === 0);
    expect(await page.evaluate(() => CSS.highlights.get('curanno-annotation-focus')?.size)).toBe(0);
  });

  it('reports selections as selectors on the page and clears them on request', async () => {
    await selectText(page, 'Four members supported it');
    await sidebar.waitForFunction(() => window.__fakeSidebar.selection !== null);
    const selection = await sidebar.evaluate(() => window.__fakeSidebar.selection);
    expect(selection?.quote).toBe('Four members supported it');
    expect(selection?.target).toMatchObject({ type: 'SpecificResource', source: PAGE_URL() });
    const types = (selection?.target.selector as { type: string }[]).map((s) => s.type);
    expect(types).toEqual(['TextQuoteSelector', 'TextPositionSelector', 'RangeSelector']);
    await sidebar.evaluate(() => window.__fakeSidebar.clearSelection());
    await sidebar.waitForFunction(() => window.__fakeSidebar.selection === null);
    expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  });

  it('re-anchors after the page changes and reports only what changed', async () => {
    await anchorQuote('urn:a1', 'Four members supported it', {
      prefix: 'would need a quote fallback. ',
      suffix: ', with the condition that the fa',
    });
    await anchorQuote('urn:a2', 'Two members supported it');
    const before = (await messages('anchoring.results')).length;
    // Delete the annotated sentence; the near-duplicate "Two members supported it" stays.
    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        const at = text.data.indexOf('Four members supported it');
        if (at < 0) continue;
        text.data = text.data.slice(0, at);
        return;
      }
    });
    await sidebar.waitForFunction(
      (n) => window.__fakeSidebar.messages.filter((m) => m.type === 'anchoring.results').length > n,
      before,
    );
    const latest = (await messages('anchoring.results')).at(-1) as { results: AnchoringResult[] };
    expect(latest.results.map((r) => r.id)).toEqual(['urn:a1']);
    expect(latest.results[0]?.state).toBe('orphaned');
    expect(await highlightedTexts()).toEqual(['Two members supported it']);
  });

  it('scrolls to an annotation and reports clicks on highlights', async () => {
    await anchorQuote('urn:a1', 'Four members supported it');
    await page.evaluate(() => window.scrollTo(0, 0));
    await sidebar.evaluate(() => window.__fakeSidebar.scrollTo('urn:a1'));
    await page.waitForTimeout(500);
    const box = await page.evaluate(() => {
      const range = [...CSS.highlights.get('curanno-annotation')!][0] as Range;
      const rect = range.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        h: window.innerHeight,
      };
    });
    expect(box.y).toBeGreaterThan(0);
    expect(box.y).toBeLessThan(box.h);
    await page.mouse.click(box.x, box.y);
    await sidebar.waitForFunction(() => window.__fakeSidebar.activated.length > 0);
    expect(await sidebar.evaluate(() => window.__fakeSidebar.activated)).toEqual([['urn:a1']]);
    await page.mouse.move(box.x, box.y + 1);
    await sidebar.waitForFunction(() => window.__fakeSidebar.hovered.length > 0);
    expect(await sidebar.evaluate(() => window.__fakeSidebar.hovered)).toEqual(['urn:a1']);
  });

  it('tears down cleanly', async () => {
    await anchorQuote('urn:a1', 'Four members supported it');
    await page.evaluate(() => window.__curannoGuest?.destroy());
    expect(await page.evaluate(() => window.__curannoGuest)).toBeUndefined();
    expect(page.frames().filter((f) => f.url().startsWith(h.sidebar.origin))).toHaveLength(0);
    expect(
      await page.evaluate(() => document.querySelectorAll('[data-curanno-guest]').length),
    ).toBe(0);
    expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  });

  it('reports the page text when asked, and draws suggestions apart from annotations', async () => {
    const hello = await messages('guest.hello');
    expect(hello[0]).toMatchObject({ capabilities: { text: true } });
    await sidebar.waitForFunction(() => window.__fakeSidebar.document !== undefined);
    const report = await sidebar.evaluate(() => {
      const fake = window.__fakeSidebar;
      const next = fake.next('text.report');
      fake.requestText('r1');
      return next;
    });
    expect(report.requestId).toBe('r1');
    expect(report.scopes).toHaveLength(1);
    const [scope] = report.scopes;
    const paragraph = await page.evaluate(
      () => document.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
    expect(paragraph.length).toBeGreaterThan(10);
    expect(scope?.text).toContain(paragraph);
    const start = scope?.blockStarts?.[0];
    expect(start).toBeGreaterThan(0);

    const exact = scope?.text.slice(start, (start ?? 0) + 20) ?? '';
    await sidebar.evaluate(
      ([exact, source]) =>
        window.__fakeSidebar.anchor([
          {
            id: 'urn:uuid:suggested-1',
            style: 'suggested',
            target: { source, selector: [{ type: 'TextQuoteSelector', exact }] },
          },
        ]),
      [exact, PAGE_URL()] as const,
    );
    await sidebar.waitForFunction(() => window.__fakeSidebar.anchoring.has('urn:uuid:suggested-1'));
    const drawn = await page.evaluate(() => ({
      suggested: [...(CSS.highlights.get('curanno-suggestion') ?? [])].map((r) =>
        (r as Range).toString(),
      ),
      annotations: [...(CSS.highlights.get('curanno-annotation') ?? [])].length,
    }));
    expect(drawn).toEqual({ suggested: [exact], annotations: 0 });
  });
});
