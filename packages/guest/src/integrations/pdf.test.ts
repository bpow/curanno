// @vitest-environment happy-dom
import type { Selector, TextQuoteSelector } from '@curanno/model';
import { describe, expect, it } from 'vitest';
import { createScope } from '../anchoring/scope.js';
import { PdfIntegration, pageFragmentSelector, pageOfFragment, pdfUrn } from './pdf.js';
import { pageTextScope, type PdfTextItem } from './pdf-text.js';

/** Items as PDF.js reports them for a page: a running header artifact, two lines, a word split in two. */
const PAGE_ITEMS: PdfTextItem[] = [
  { type: 'beginMarkedContentProps', tag: 'Artifact' },
  { str: 'Running header', hasEOL: true },
  { type: 'endMarkedContent' },
  { str: 'Ten Simple Rules for ', hasEOL: false },
  { str: 'Reproducible', hasEOL: true },
  { str: 'Research', hasEOL: true },
  { str: '', hasEOL: false },
  { str: 'Replication is the cornerstone of a', hasEOL: true },
  { str: 'cumulative science.', hasEOL: false },
];

/** The same page as PDF.js's text layer renders it. */
function renderLayer(items: PdfTextItem[]): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  let container: HTMLElement = layer;
  for (const item of items) {
    if (item.str === undefined) {
      if (item.type?.startsWith('beginMarkedContent')) {
        const span = document.createElement('span');
        span.className = 'markedContent';
        if (item.tag === 'Artifact') span.setAttribute('aria-hidden', 'true');
        container.appendChild(span);
        container = span;
      } else if (item.type === 'endMarkedContent') {
        container = container.parentElement ?? layer;
      }
      continue;
    }
    if (item.str !== '') {
      const span = document.createElement('span');
      span.setAttribute('role', 'presentation');
      span.textContent = item.str;
      container.appendChild(span);
    }
    if (item.hasEOL) container.appendChild(document.createElement('br'));
  }
  const end = document.createElement('div');
  end.className = 'endOfContent';
  layer.appendChild(end);
  return layer;
}

type Listener = (event: { pageNumber: number }) => void;

/** A stand-in for PDF.js's viewer and document: pages render on demand. */
function fakeViewer(pages: PdfTextItem[][]) {
  const listeners = new Map<string, Set<Listener>>();
  const viewer = document.createElement('div');
  viewer.className = 'pdfViewer';
  document.body.appendChild(viewer);
  for (let i = 1; i <= pages.length; i++) {
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset['pageNumber'] = String(i);
    viewer.appendChild(page);
  }
  const bus = {
    on(name: string, l: Listener) {
      listeners.set(name, (listeners.get(name) ?? new Set()).add(l));
    },
    off(name: string, l: Listener) {
      listeners.get(name)?.delete(l);
    },
    dispatch(name: string, event: { pageNumber: number }) {
      for (const l of listeners.get(name) ?? []) l(event);
    },
  };
  return {
    viewerLike: { viewer, currentPageNumber: 1, eventBus: bus },
    documentLike: {
      numPages: pages.length,
      fingerprints: ['abc123', null] as [string, string | null],
      getPage: (n: number) =>
        Promise.resolve({
          getTextContent: () => Promise.resolve({ items: pages[n - 1] as PdfTextItem[] }),
        }),
      getMetadata: () => Promise.resolve({ info: { Title: 'Ten Simple Rules' } }),
    },
    render(n: number) {
      const page = viewer.querySelector(`.page[data-page-number="${n}"]`) as HTMLElement;
      page.appendChild(renderLayer(pages[n - 1] as PdfTextItem[]));
      bus.dispatch('textlayerrendered', { pageNumber: n });
    },
    unload(n: number) {
      viewer.querySelector(`.page[data-page-number="${n}"] .textLayer`)?.remove();
    },
  };
}

function quote(exact: string, context: Partial<TextQuoteSelector> = {}): Selector {
  return { type: 'TextQuoteSelector', exact, ...context };
}

/** Mutation records are delivered asynchronously. */
async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('pageTextScope', () => {
  it('builds the text the rendered layer has, hiding artifacts and breaking at EOL', () => {
    const scope = pageTextScope(PAGE_ITEMS);
    expect(scope.map.text).toBe(
      'Ten Simple Rules for Reproducible\nResearch\nReplication is the cornerstone of a\ncumulative science.',
    );
    // The same text the DOM-based extraction gives for the rendered layer.
    const layer = renderLayer(PAGE_ITEMS);
    document.body.appendChild(layer);
    expect(createScope(layer).map.text).toBe(scope.map.text);
    layer.remove();
  });
});

describe('PdfIntegration', () => {
  it('reports the PDF identity with its fingerprint and title', async () => {
    const v = fakeViewer([PAGE_ITEMS]);
    const pdf = new PdfIntegration({
      viewer: v.viewerLike,
      document: v.documentLike,
      url: 'https://example.org/paper.pdf',
    });
    expect(await pdf.document()).toEqual({
      uri: 'https://example.org/paper.pdf',
      title: 'Ten Simple Rules',
      links: [
        { uri: 'https://example.org/paper.pdf', relation: 'self' },
        { uri: 'urn:x-pdf:abc123', relation: 'pdf_fingerprint' },
      ],
    });
    expect(pdf.source()).toBe('https://example.org/paper.pdf');
    // A local file is identified by its fingerprint alone.
    const local = new PdfIntegration({
      viewer: v.viewerLike,
      document: v.documentLike,
      url: pdfUrn('abc123'),
      title: 'local.pdf',
    });
    expect((await local.document()).links).toEqual([{ uri: 'urn:x-pdf:abc123', relation: 'self' }]);
  });

  it('reports the text of every page, rendered or not, as the text model has it', async () => {
    const v = fakeViewer([PAGE_ITEMS, [{ str: 'Second page.', hasEOL: false }]]);
    const pdf = new PdfIntegration({
      viewer: v.viewerLike,
      document: v.documentLike,
      url: 'https://example.org/paper.pdf',
    });
    v.render(1);
    expect(await pdf.text()).toEqual([
      { text: pageTextScope(PAGE_ITEMS).map.text, page: 1 },
      { text: 'Second page.', page: 2 },
    ]);
  });

  it('anchors a page that is not rendered in its text content, then draws it when it renders', async () => {
    const v = fakeViewer([PAGE_ITEMS, PAGE_ITEMS]);
    const pdf = new PdfIntegration({
      viewer: v.viewerLike,
      document: v.documentLike,
      url: 'https://example.org/paper.pdf',
    });
    const changes: number[] = [];
    const stop = pdf.observe(() => changes.push(changes.length));
    const selectors = [pageFragmentSelector(2, [quote('cumulative science.')])];

    const unrendered = await pdf.anchor(selectors);
    expect(unrendered.result).toMatchObject({ state: 'anchored', via: 'quote' });
    expect(unrendered.ranges).toEqual([]);

    v.render(2);
    expect(changes).toHaveLength(1);
    const rendered = await pdf.anchor(selectors);
    expect(rendered.result).toEqual(unrendered.result);
    expect(rendered.ranges).toHaveLength(1);
    expect(rendered.ranges[0]?.toString()).toBe('cumulative science.');

    // The page scrolls away: its text layer goes, the result stays, the range goes.
    v.unload(2);
    await tick();
    expect(changes).toHaveLength(2);
    const unloaded = await pdf.anchor(selectors);
    expect(unloaded.result).toEqual(unrendered.result);
    expect(unloaded.ranges).toEqual([]);
    stop();
  });

  it('orphans targets without a page fragment or beyond the last page', async () => {
    const v = fakeViewer([PAGE_ITEMS]);
    const pdf = new PdfIntegration({
      viewer: v.viewerLike,
      document: v.documentLike,
      url: 'https://example.org/paper.pdf',
    });
    expect((await pdf.anchor([quote('Research')])).result).toMatchObject({
      state: 'orphaned',
      reason: 'no page fragment selector',
    });
    expect((await pdf.anchor([pageFragmentSelector(7, [quote('Research')])])).result).toMatchObject(
      { state: 'orphaned', reason: 'no page 7' },
    );
    expect((await pdf.anchor([pageFragmentSelector(1, [quote('nowhere')])])).result).toMatchObject({
      state: 'orphaned',
    });
    // A whole-page target anchors without a range.
    expect(await pdf.anchor([pageFragmentSelector(1, [])])).toEqual({
      result: { state: 'anchored' },
      ranges: [],
    });
  });

  it('describes a selection as a page fragment refined by text selectors, clipped to the page', async () => {
    const v = fakeViewer([PAGE_ITEMS, PAGE_ITEMS]);
    const pdf = new PdfIntegration({
      viewer: v.viewerLike,
      document: v.documentLike,
      url: 'https://example.org/paper.pdf',
    });
    pdf.observe(() => undefined);
    v.render(1);
    v.render(2);
    const spans = v.viewerLike.viewer.querySelectorAll(
      '.page[data-page-number="1"] .textLayer span[role]',
    );
    const range = document.createRange();
    range.setStart(spans[3]!.firstChild as Text, 0); // "Research" (span 0 is the artifact)
    // Runs on into page 2: clipped to the end of page 1.
    const page2 = v.viewerLike.viewer.querySelector(
      '.page[data-page-number="2"] .textLayer span[role]',
    )!;
    range.setEnd(page2.firstChild as Text, 3);
    const described = pdf.describe(range);
    expect(described?.quote).toBe(
      'Research\nReplication is the cornerstone of a\ncumulative science.',
    );
    expect(described?.selectors).toHaveLength(1);
    const fragment = described!.selectors[0]!;
    expect(fragment).toMatchObject({
      type: 'FragmentSelector',
      conformsTo: 'http://tools.ietf.org/rfc/rfc3778',
      value: 'page=1',
    });
    const refined = (fragment as { refinedBy: Selector[] }).refinedBy;
    expect(refined.map((s) => s.type)).toEqual([
      'TextQuoteSelector',
      'TextPositionSelector',
      'RangeSelector',
    ]);
    expect(refined[1]).toEqual({ type: 'TextPositionSelector', start: 34, end: 98 });
    // The described selectors anchor back to the same text, on the DOM and off it.
    const back = await pdf.anchor(described!.selectors);
    expect(back.result).toMatchObject({ state: 'anchored', via: 'range' });
    expect(back.ranges[0]?.toString()).toBe(
      'ResearchReplication is the cornerstone of acumulative science.',
    );
    v.unload(1);
    expect((await pdf.anchor(described!.selectors)).result).toMatchObject({
      state: 'anchored',
      via: 'position',
    });
  });

  it('finds text that moved to another page and says which', async () => {
    const page2: PdfTextItem[] = [
      { str: 'Appendix', hasEOL: true },
      { str: 'Replication is the cornerstone of a', hasEOL: true },
      { str: 'cumulative science.', hasEOL: false },
    ];
    const page1 = PAGE_ITEMS.slice(0, 6);
    const v = fakeViewer([page1, page2, page2]);
    const pdf = new PdfIntegration({
      viewer: v.viewerLike,
      document: v.documentLike,
      url: 'https://example.org/paper.pdf',
    });
    const quoteOnly = [pageFragmentSelector(1, [quote('cumulative science.')])];
    // Present on two other pages: ambiguous rather than a guess (ADR 0010).
    expect((await pdf.anchor(quoteOnly)).result).toMatchObject({ state: 'ambiguous' });
    const v2 = fakeViewer([page1, page2, page1]);
    const pdf2 = new PdfIntegration({
      viewer: v2.viewerLike,
      document: v2.documentLike,
      url: 'https://example.org/paper.pdf',
    });
    const moved = await pdf2.anchor([
      pageFragmentSelector(3, [
        quote('cumulative science.', { prefix: 'the cornerstone of a\n' }),
        { type: 'TextPositionSelector', start: 80, end: 99 },
      ]),
    ]);
    expect(moved.result).toMatchObject({ state: 'anchored', via: 'quote', page: 2 });
    expect(moved.ranges).toEqual([]);
    // Nowhere at all: the orphan from the named page.
    expect(
      (await pdf2.anchor([pageFragmentSelector(1, [quote('zebra crossing')])])).result,
    ).toMatchObject({
      state: 'orphaned',
      reason: 'quote not found',
    });
  });

  it('parses page fragments', () => {
    expect(pageOfFragment('page=3')).toBe(3);
    expect(pageOfFragment('page=3&viewrect=0,0,1,1')).toBe(3);
    expect(pageOfFragment('page=0')).toBeUndefined();
    expect(pageOfFragment('nameddest=x')).toBeUndefined();
  });
});
