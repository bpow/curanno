/**
 * The PDF.js viewer integration. A PDF target is a `FragmentSelector` naming
 * a page, refined by the text selectors scoped to that page's text (text
 * model, section 11). Pages come and go: PDF.js renders a text layer when a
 * page nears the viewport and removes it when the page scrolls far away.
 * A rendered page is anchored in its text layer and highlighted; a page
 * that is not rendered is anchored in the text PDF.js would render, built
 * from the document's text content, so the sidebar learns the result at
 * once and the highlight appears when the page does. Results are kept
 * when a page unloads; only its highlights go.
 *
 * The viewer and document are typed structurally so this package does not
 * depend on pdfjs-dist; the viewer page passes PDF.js's own objects.
 */
import {
  deriveDocumentUris,
  type GuestDocument,
  type Selector,
  type TargetAnchoringResult,
  type TextRange,
} from '@scale/model';
import type { AnchorOptions } from '../anchoring/anchor.js';
import { createScope, type AnchoringScope } from '../anchoring/scope.js';
import { anchorInScope } from './html.js';
import { pageTextScope, type PdfTextItem, type VirtualNode } from './pdf-text.js';
import { describeSelection } from './selection.js';
import type { AnchoredTarget, DescribedSelection, DocumentIntegration } from './types.js';

/** The `conformsTo` of a page fragment (RFC 3778, `page=N`). */
export const PDF_FRAGMENT_CONFORMS_TO = 'http://tools.ietf.org/rfc/rfc3778';

export interface PdfPageLike {
  getTextContent(options: {
    includeMarkedContent: boolean;
    disableNormalization: boolean;
  }): Promise<{ items: PdfTextItem[] }>;
}

export interface PdfDocumentLike {
  numPages: number;
  /** PDF.js's fingerprints: the trailer id or a hash of the file, and the modified id. */
  fingerprints: [string, string | null];
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getMetadata(): Promise<{ info: Record<string, unknown> }>;
}

export interface PdfEventBusLike {
  on(name: string, listener: (event: { pageNumber: number }) => void): void;
  off(name: string, listener: (event: { pageNumber: number }) => void): void;
}

export interface PdfViewerLike {
  /** The element holding the page elements (`PDFViewer.viewer`). */
  viewer: HTMLElement;
  currentPageNumber: number;
  eventBus: PdfEventBusLike;
}

export interface PdfIntegrationOptions {
  viewer: PdfViewerLike;
  document: PdfDocumentLike;
  /** The PDF's URL, or `urn:x-pdf:<fingerprint>` for a file that has none. */
  url: string;
  title?: string;
  anchoring?: AnchorOptions;
}

/** The page a fragment selector names, when it is a page fragment. */
export function pageOfFragment(value: string): number | undefined {
  const match = /^page=(\d+)(?:$|&)/.exec(value);
  const page = match ? Number(match[1]) : NaN;
  return Number.isInteger(page) && page > 0 ? page : undefined;
}

export function pageFragmentSelector(page: number, refinedBy: Selector[]): Selector {
  return {
    type: 'FragmentSelector',
    conformsTo: PDF_FRAGMENT_CONFORMS_TO,
    value: `page=${page}`,
    refinedBy,
  };
}

/** The `urn:x-pdf:` identifier for a PDF without a URL. */
export function pdfUrn(fingerprint: string): string {
  return `urn:x-pdf:${fingerprint}`;
}

export class PdfIntegration implements DocumentIntegration {
  readonly root: Element;
  private readonly options: PdfIntegrationOptions;
  /** Pages whose text layer PDF.js reported rendered and that is still in the DOM. */
  private readonly rendered = new Set<number>();
  private readonly domScopes = new Map<number, AnchoringScope>();
  private readonly textScopes = new Map<number, Promise<AnchoringScope<VirtualNode>>>();

  constructor(options: PdfIntegrationOptions) {
    this.options = options;
    this.root = options.viewer.viewer;
  }

  source(): string {
    return this.options.url;
  }

  async document(): Promise<GuestDocument> {
    const { document: pdf, url } = this.options;
    const fingerprint = pdf.fingerprints[0];
    let title = this.options.title;
    if (!title) {
      try {
        const info = (await pdf.getMetadata()).info;
        const fromInfo = info['Title'];
        if (typeof fromInfo === 'string' && fromInfo.trim()) title = fromInfo.trim();
      } catch {
        // No metadata is fine; the URL stands in.
      }
    }
    const links = deriveDocumentUris({ url, pdfFingerprint: fingerprint }).map(
      ({ uri, relation }) => ({ uri, relation }),
    );
    return { uri: url, ...(title ? { title } : {}), links };
  }

  prepare(): void {
    // Scopes are invalidated by the viewer's events, not per pass.
  }

  async anchor(selectors: Selector[]): Promise<AnchoredTarget> {
    const fragment = selectors.find((s) => s.type === 'FragmentSelector');
    const page = fragment ? pageOfFragment(fragment.value) : undefined;
    if (!fragment || page === undefined) {
      return { result: { state: 'orphaned', reason: 'no page fragment selector' }, ranges: [] };
    }
    if (page > this.options.document.numPages) {
      return { result: { state: 'orphaned', reason: `no page ${page}` }, ranges: [] };
    }
    const refined = fragment.refinedBy
      ? Array.isArray(fragment.refinedBy)
        ? fragment.refinedBy
        : [fragment.refinedBy]
      : [];
    const onPage = await this.anchorOnPage(page, refined);
    if (onPage.result.state === 'anchored') return onPage;
    return (await this.anchorElsewhere(page, refined)) ?? onPage;
  }

  /** Anchor in a page's rendered text layer, or in its text content when it is not rendered. */
  private async anchorOnPage(page: number, selectors: Selector[]): Promise<AnchoredTarget> {
    const live = this.domScope(page);
    if (live) return anchorInScope(live, selectors, this.options.anchoring);
    const scope = await this.textScope(page);
    const result = anchorInScope(scope, selectors, this.options.anchoring);
    return { result: result.result, ranges: [] };
  }

  /**
   * Text that is gone from its page may have moved to another one in a
   * revised file: look for the quote on the other pages, nearest first. One
   * page with a match anchors there (and says so in `page`); several are
   * ambiguous; none leaves the orphan.
   */
  private async anchorElsewhere(
    page: number,
    selectors: Selector[],
  ): Promise<AnchoredTarget | undefined> {
    const quote = selectors.find((s) => s.type === 'TextQuoteSelector');
    if (!quote) return undefined;
    const found: AnchoredTarget[] = [];
    const candidates: TextRange[] = [];
    const { numPages } = this.options.document;
    for (let distance = 1; distance < numPages; distance++) {
      for (const other of [page - distance, page + distance]) {
        if (other < 1 || other > numPages) continue;
        const result = await this.anchorOnPage(other, [quote]);
        if (result.result.state === 'anchored') {
          found.push({ result: { ...result.result, page: other }, ranges: result.ranges });
        } else if (result.result.state === 'ambiguous') {
          candidates.push(...result.result.candidates);
        }
      }
    }
    if (found.length === 1 && candidates.length === 0) return found[0];
    if (found.length + candidates.length > 1) {
      for (const f of found) {
        if (f.result.state === 'anchored' && f.result.range) candidates.push(f.result.range);
      }
      return { result: { state: 'ambiguous', candidates }, ranges: [] };
    }
    return undefined;
  }

  describe(range: Range): DescribedSelection | undefined {
    const layer = textLayerOf(range.startContainer);
    const page = layer ? pageNumberOf(layer) : undefined;
    if (!layer || page === undefined) return undefined;
    const scope = this.domScope(page);
    if (!scope) return undefined;
    // A selection that runs into the next page stops at the end of this one.
    const within = range.cloneRange();
    if (!layer.contains(within.endContainer)) within.setEnd(layer, layer.childNodes.length);
    const described = describeSelection(scope, within);
    if (!described) return undefined;
    return {
      selectors: [pageFragmentSelector(page, described.selectors)],
      quote: described.quote,
    };
  }

  scrollTo(ranges: Range[], targets: { selectors: Selector[]; result: TargetAnchoringResult }[]) {
    const element = ranges[0]?.startContainer.parentElement;
    if (element) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Nothing drawn: go to the page the text was found on, else the one named.
    for (const { selectors, result } of targets) {
      const fragment = selectors.find((s) => s.type === 'FragmentSelector');
      const named = fragment ? pageOfFragment(fragment.value) : undefined;
      const page = result.state === 'anchored' ? (result.page ?? named) : named;
      if (page !== undefined) {
        this.options.viewer.currentPageNumber = page;
        return;
      }
    }
  }

  observe(onChange: () => void): () => void {
    const { eventBus } = this.options.viewer;
    const onRendered = ({ pageNumber }: { pageNumber: number }): void => {
      this.rendered.add(pageNumber);
      this.domScopes.delete(pageNumber);
      onChange();
    };
    eventBus.on('textlayerrendered', onRendered);
    // PDF.js removes the text layer of a page that scrolls far away; its
    // result is kept and only its highlights go.
    const view = this.root.ownerDocument.defaultView as Window & typeof globalThis;
    const observer = new view.MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        for (const node of Array.from(record.removedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node as Element;
          // A removed layer has no ancestors any more; its page is the record's target.
          const pages = element.classList.contains('textLayer')
            ? [pageNumberOf(record.target as Element)]
            : Array.from(element.querySelectorAll('.textLayer'), pageNumberOf);
          for (const page of pages) {
            if (page !== undefined && this.rendered.delete(page)) {
              this.domScopes.delete(page);
              changed = true;
            }
          }
        }
      }
      if (changed) onChange();
    });
    observer.observe(this.root, { childList: true, subtree: true });
    return () => {
      eventBus.off('textlayerrendered', onRendered);
      observer.disconnect();
    };
  }

  destroy(): void {
    this.rendered.clear();
    this.domScopes.clear();
    this.textScopes.clear();
  }

  /** The scope over a page's rendered text layer, or undefined when it is not rendered. */
  private domScope(page: number): AnchoringScope | undefined {
    if (!this.rendered.has(page)) return undefined;
    const cached = this.domScopes.get(page);
    if (cached && cached.root.isConnected) return cached;
    const layer = this.textLayer(page);
    if (!layer) {
      this.rendered.delete(page);
      return undefined;
    }
    const scope = createScope(layer);
    this.domScopes.set(page, scope);
    return scope;
  }

  private textLayer(page: number): Element | null {
    return this.root.querySelector(`.page[data-page-number="${page}"] .textLayer`);
  }

  private textScope(page: number): Promise<AnchoringScope<VirtualNode>> {
    let scope = this.textScopes.get(page);
    if (!scope) {
      scope = this.options.document.getPage(page).then(async (p) => {
        const content = await p.getTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        });
        return pageTextScope(content.items);
      });
      scope.catch(() => this.textScopes.delete(page));
      this.textScopes.set(page, scope);
    }
    return scope;
  }
}

function textLayerOf(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('.textLayer') ?? null;
}

function pageNumberOf(layer: Element): number | undefined {
  const page = layer.closest('.page')?.getAttribute('data-page-number');
  const n = page === null || page === undefined ? NaN : Number(page);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
