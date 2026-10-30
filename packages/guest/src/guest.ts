/**
 * The guest: wires the anchoring, highlights, observers and the RPC
 * connection together for one document (ADR 0007, 0008). It keeps the
 * sidebar's anchor requests (identifiers and selectors only), re-anchors
 * them whenever the document changes, and reports what it found. Where the
 * text lives and when it changes is the document integration's business:
 * an HTML page by default, a PDF.js viewer through `PdfIntegration`.
 */
import {
  selectorsOfTarget,
  type AnchorRequest,
  type AnchoringResult,
  type GuestRole,
  type GuestSelection,
  type SidebarMessage,
  type SpecificResource,
  type TargetAnchoringResult,
} from '@curanno/model';
import type { AnchorOptions } from './anchoring/anchor.js';
import {
  HighlightIndex,
  createHighlightRenderer,
  type HighlightEntry,
  type HighlightRenderer,
} from './highlights/index.js';
import { injectFrames } from './frames.js';
import { HtmlIntegration, isGuestOwned } from './integrations/html.js';
import type { AnchoredTargetSelectors, DocumentIntegration } from './integrations/types.js';
import { observeSelection } from './observers/selection.js';
import { GuestConnection, type Connection, type GuestConnectionOptions } from './rpc/connection.js';
import { Host } from './rpc/host.js';
import { SubGuestConnection } from './rpc/sub-connection.js';
import { SidebarFrame } from './sidebar-frame.js';

export interface GuestOptions {
  /** Origin the sidebar is served from; the only origin the guest talks to. */
  sidebarOrigin: string;
  /** Path of the sidebar page on that origin. Default `/`. */
  sidebarPath?: string;
  /**
   * `host` (the default) creates the sidebar frame and serves the page's
   * other frames; `sub` is a guest in another frame of the page, which
   * connects through the host in the top frame and shows no sidebar.
   */
  role?: GuestRole;
  /**
   * The bundle's own URL; the host injects it into same-origin frames so
   * that they get guests of their own. Omitted, frames are left alone.
   */
  bundleUrl?: string;
  /** The document; default an HTML integration over `root` or the body. */
  integration?: DocumentIntegration;
  /** Anchoring root of the default HTML integration. Default `document.body`. */
  root?: Element;
  document?: Document;
  /** Show the sidebar at start. Default true. */
  open?: boolean;
  anchoring?: AnchorOptions;
  mutationDebounceMs?: number;
  selectionDebounceMs?: number;
  /** Supplies the message channel; tests inject one. */
  createChannel?: GuestConnectionOptions['createChannel'];
  /**
   * Called with the number of annotations the sidebar has asked this guest
   * to anchor whenever it changes; the browser extension shows it on its
   * badge. A count is all it gets, never identifiers or selectors.
   */
  onAnchorCount?: (count: number) => void;
}

interface Anchored {
  result: AnchoringResult;
  ranges: Range[];
  /** Each target's selectors with its result, for scrolling towards an undrawn one. */
  targets: AnchoredTargetSelectors[];
}

export class Guest {
  readonly id: string;
  readonly role: GuestRole;
  private readonly doc: Document;
  private readonly integration: DocumentIntegration;
  private readonly options: GuestOptions;
  private frame: SidebarFrame | undefined;
  private connection: Connection | undefined;
  private host: Host | undefined;
  private sidebarReady = false;
  private renderer: HighlightRenderer | undefined;
  private readonly index = new HighlightIndex();
  private readonly requests = new Map<string, AnchorRequest>();
  private readonly anchored = new Map<string, Anchored>();
  private focused: ReadonlySet<string> = new Set();
  private hovered: string[] = [];
  private lastSelection: string | null | undefined;
  private hoverFrame = 0;
  private readonly cleanups: (() => void)[] = [];
  /** Anchoring passes run one at a time, in order. */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: GuestOptions) {
    this.options = options;
    this.doc = options.document ?? document;
    this.integration =
      options.integration ??
      new HtmlIntegration({
        document: this.doc,
        ...(options.root ? { root: options.root } : {}),
        ...(options.anchoring ? { anchoring: options.anchoring } : {}),
        ...(options.mutationDebounceMs !== undefined
          ? { mutationDebounceMs: options.mutationDebounceMs }
          : {}),
      });
    this.id = randomId();
    this.role = options.role ?? 'host';
  }

  get root(): Element {
    return this.integration.root;
  }

  /** Inject the sidebar frame (as the host), connect and start observing. */
  start(): void {
    if (this.connection) return;
    const doc = this.doc;
    const view = doc.defaultView as Window;
    this.renderer = createHighlightRenderer(doc, this.root);
    const capabilities = { highlights: this.renderer.technique, role: this.role };
    if (this.role === 'sub') {
      this.connection = new SubGuestConnection({
        window: view,
        guestId: this.id,
        capabilities,
        onMessage: (message) => this.handle(message),
        onConnected: () => this.onConnected(),
      });
    } else {
      this.frame = new SidebarFrame(doc, {
        sidebarOrigin: this.options.sidebarOrigin,
        sidebarPath: this.options.sidebarPath ?? '/',
        open: this.options.open ?? true,
      });
      this.frame.onVisibility((open) => this.send({ type: 'sidebar.visibility', open }));
      const sidebarWindow = (): Window | null => this.frame?.contentWindow ?? null;
      this.connection = new GuestConnection({
        window: view,
        sidebarWindow,
        sidebarOrigin: this.options.sidebarOrigin,
        guestId: this.id,
        capabilities,
        onMessage: (message) => this.handle(message),
        onConnected: () => this.onConnected(),
        onSidebarReady: () => {
          this.sidebarReady = true;
          this.host?.announce();
        },
        ...(this.options.createChannel ? { createChannel: this.options.createChannel } : {}),
      });
      this.host = new Host({
        window: view,
        sidebarWindow,
        sidebarOrigin: this.options.sidebarOrigin,
        sidebarReady: () => this.sidebarReady,
        ...(this.options.createChannel ? { createChannel: this.options.createChannel } : {}),
      });
      if (this.options.bundleUrl) {
        this.cleanups.push(
          injectFrames({
            document: doc,
            bundleUrl: this.options.bundleUrl,
            sidebarOrigin: this.options.sidebarOrigin,
            sidebarPath: this.options.sidebarPath ?? '/',
          }),
        );
      }
    }

    this.cleanups.push(
      this.integration.observe(() => this.onChange()),
      observeSelection(doc, {
        root: this.root,
        isOwned: isGuestOwned,
        onChange: (range) => this.onSelection(range),
        ...(this.options.selectionDebounceMs !== undefined
          ? { debounceMs: this.options.selectionDebounceMs }
          : {}),
      }),
    );

    const onMove = (event: PointerEvent): void => this.onPointerMove(event);
    const onClick = (event: MouseEvent): void => this.onClick(event);
    const invalidate = (): void => this.index.invalidate();
    doc.addEventListener('pointermove', onMove, { passive: true });
    doc.addEventListener('click', onClick);
    doc.addEventListener('scroll', invalidate, { capture: true, passive: true });
    doc.defaultView?.addEventListener('resize', invalidate);
    this.cleanups.push(() => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('scroll', invalidate, { capture: true });
      doc.defaultView?.removeEventListener('resize', invalidate);
    });
  }

  /** Remove everything the guest added to the page. */
  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.hoverFrame !== 0) this.doc.defaultView?.cancelAnimationFrame(this.hoverFrame);
    this.connection?.close();
    this.host?.close();
    this.renderer?.dispose();
    this.frame?.remove();
    this.integration.destroy();
    this.connection = undefined;
    this.host = undefined;
    this.sidebarReady = false;
    this.renderer = undefined;
    this.frame = undefined;
    this.requests.clear();
    this.anchored.clear();
  }

  get sidebarOpen(): boolean {
    return this.frame?.open ?? false;
  }

  openSidebar(): void {
    this.frame?.setOpen(true);
  }

  closeSidebar(): void {
    this.frame?.setOpen(false);
  }

  toggleSidebar(): void {
    this.frame?.toggle();
  }

  /** Current results, for tests and the dev page. */
  anchoringResults(): AnchoringResult[] {
    return [...this.anchored.values()].map((a) => a.result);
  }

  /** Resolves once every queued anchoring pass has run. */
  settled(): Promise<void> {
    return this.queue;
  }

  // -------------------------------------------------------------------------

  private send(message: Parameters<Connection['send']>[0]): void {
    this.connection?.send(message);
  }

  /** Run `task` after the passes already queued; errors are reported, not thrown. */
  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((err: unknown) => {
      this.connection?.error(err instanceof Error ? err.message : String(err));
    });
  }

  private onConnected(): void {
    this.enqueue(async () => {
      this.send({ type: 'document.report', document: await this.integration.document() });
      if (this.frame) this.send({ type: 'sidebar.visibility', open: this.sidebarOpen });
      if (this.requests.size > 0) {
        this.send({ type: 'anchoring.results', results: await this.anchorAll() });
      }
    });
  }

  private handle(message: SidebarMessage): void {
    switch (message.type) {
      case 'annotations.anchor':
        for (const request of message.requests) this.requests.set(request.id, request);
        this.options.onAnchorCount?.(this.requests.size);
        this.enqueue(async () => {
          const results = await this.anchorAll(message.requests.map((r) => r.id));
          this.send({ type: 'anchoring.results', results });
        });
        break;
      case 'annotations.unanchor':
        for (const id of message.ids) {
          this.requests.delete(id);
          this.anchored.delete(id);
        }
        this.options.onAnchorCount?.(this.requests.size);
        this.draw();
        break;
      case 'highlights.focus':
        this.focused = new Set(message.ids);
        this.renderer?.focus(this.focused);
        break;
      case 'scroll.to':
        this.scrollTo(message.id);
        break;
      case 'selection.clear':
        this.doc.getSelection()?.removeAllRanges();
        this.reportSelection(null);
        break;
      case 'sidebar.open':
        this.openSidebar();
        break;
      case 'sidebar.close':
        this.closeSidebar();
        break;
      case 'sidebar.toggle':
        this.toggleSidebar();
        break;
      case 'sidebar.error':
      case 'sidebar.hello':
        break;
    }
  }

  /** Anchor the given requests (all when omitted), redraw and return their results. */
  private async anchorAll(ids?: string[]): Promise<AnchoringResult[]> {
    this.integration.prepare();
    const results: AnchoringResult[] = [];
    for (const id of ids ?? [...this.requests.keys()]) {
      const request = this.requests.get(id);
      if (!request) continue;
      const targets = Array.isArray(request.target) ? request.target : [request.target];
      const ranges: Range[] = [];
      const perTarget: TargetAnchoringResult[] = [];
      const anchoredTargets: AnchoredTargetSelectors[] = [];
      for (const target of targets) {
        const selectors = selectorsOfTarget(target);
        const anchored = await this.integration.anchor(selectors);
        perTarget.push(anchored.result);
        anchoredTargets.push({ selectors, result: anchored.result });
        ranges.push(...anchored.ranges);
      }
      // The request may have been withdrawn while a page's text was loading.
      if (this.requests.get(id) !== request) continue;
      const state = perTarget.some((t) => t.state === 'anchored')
        ? 'anchored'
        : perTarget.some((t) => t.state === 'ambiguous')
          ? 'ambiguous'
          : 'orphaned';
      const result: AnchoringResult = { id, state, targets: perTarget };
      this.anchored.set(id, { result, ranges, targets: anchoredTargets });
      results.push(result);
    }
    this.draw();
    return results;
  }

  private draw(): void {
    const entries: HighlightEntry[] = [];
    for (const [id, { ranges }] of this.anchored) {
      if (ranges.length > 0) entries.push({ id, ranges });
    }
    this.renderer?.set(entries);
    this.renderer?.focus(this.focused);
    this.index.set(entries);
  }

  /** After the document changed: re-anchor everything and report what changed. */
  private onChange(): void {
    this.enqueue(async () => {
      const before = new Map(
        [...this.anchored].map(([id, a]) => [id, JSON.stringify(a.result)] as const),
      );
      const changed = (await this.anchorAll()).filter(
        (r) => before.get(r.id) !== JSON.stringify(r),
      );
      if (changed.length > 0) this.send({ type: 'anchoring.results', results: changed });
    });
  }

  private scrollTo(id: string): void {
    const anchored = this.anchored.get(id);
    if (!anchored) return;
    this.integration.scrollTo(anchored.ranges, anchored.targets);
    this.index.invalidate();
    this.renderer?.refresh();
  }

  private onSelection(range: Range | null): void {
    const described = range ? this.integration.describe(range) : undefined;
    if (!described) {
      this.reportSelection(null);
      return;
    }
    const target: SpecificResource = {
      type: 'SpecificResource',
      source: this.integration.source(),
      selector: described.selectors,
    };
    this.reportSelection({ target, quote: described.quote });
  }

  private reportSelection(selection: GuestSelection | null): void {
    const key = selection ? JSON.stringify(selection) : null;
    if (key === this.lastSelection) return;
    this.lastSelection = key;
    this.send({ type: 'selection.changed', selection });
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.hoverFrame !== 0 || this.anchored.size === 0) return;
    const { clientX, clientY } = event;
    this.hoverFrame =
      this.doc.defaultView?.requestAnimationFrame(() => {
        this.hoverFrame = 0;
        const ids = this.index.idsAt(clientX, clientY);
        if (ids.length === this.hovered.length && ids.every((id, i) => id === this.hovered[i]))
          return;
        this.hovered = ids;
        this.send({ type: 'highlights.hovered', ids });
      }) ?? 0;
  }

  private onClick(event: MouseEvent): void {
    if (isGuestOwned(event.target as Node)) return;
    const ids = this.index.idsAt(event.clientX, event.clientY);
    if (ids.length > 0) this.send({ type: 'highlights.activated', ids });
  }
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Math.random().toString(36).slice(2);
}
