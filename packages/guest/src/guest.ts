/**
 * The guest: wires the anchoring, highlights, observers and the RPC
 * connection together for one page (ADR 0007, 0008). It keeps the
 * sidebar's anchor requests (identifiers and selectors only), re-anchors
 * them whenever the page changes, and reports what it found.
 */
import {
  selectorsOfTarget,
  textOfRange,
  type AnchorRequest,
  type AnchoringResult,
  type GuestSelection,
  type SidebarMessage,
  type SpecificResource,
  type TargetAnchoringResult,
  type TextRange,
} from '@scale/model';
import { anchor, type AnchorOptions } from './anchoring/anchor.js';
import { describeTextRange } from './anchoring/describe.js';
import { createScope, domRangeOf, textRangeOf, type AnchoringScope } from './anchoring/scope.js';
import { collectDocument } from './document-metadata.js';
import {
  GUEST_ATTRIBUTE,
  HighlightIndex,
  createHighlightRenderer,
  type HighlightEntry,
  type HighlightRenderer,
} from './highlights/index.js';
import { observeMutations } from './observers/mutation.js';
import { observeSelection } from './observers/selection.js';
import { GuestConnection, type GuestConnectionOptions } from './rpc/connection.js';
import { SidebarFrame } from './sidebar-frame.js';

export interface GuestOptions {
  /** Origin the sidebar is served from; the only origin the guest talks to. */
  sidebarOrigin: string;
  /** Path of the sidebar page on that origin. Default `/`. */
  sidebarPath?: string;
  /** Anchoring root. Default `document.body`. */
  root?: Element;
  document?: Document;
  /** Show the sidebar at start. Default true. */
  open?: boolean;
  anchoring?: AnchorOptions;
  mutationDebounceMs?: number;
  selectionDebounceMs?: number;
  /** Supplies the message channel; tests inject one. */
  createChannel?: GuestConnectionOptions['createChannel'];
}

const WHITESPACE = /^\s$/u;

export class Guest {
  readonly id: string;
  private readonly doc: Document;
  private readonly root: Element;
  private readonly options: GuestOptions;
  private scope: AnchoringScope | undefined;
  private frame: SidebarFrame | undefined;
  private connection: GuestConnection | undefined;
  private renderer: HighlightRenderer | undefined;
  private readonly index = new HighlightIndex();
  private readonly requests = new Map<string, AnchorRequest>();
  private readonly results = new Map<string, AnchoringResult>();
  private readonly ranges = new Map<string, Range[]>();
  private focused: ReadonlySet<string> = new Set();
  private hovered: string[] = [];
  private lastSelection: string | null | undefined;
  private hoverFrame = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor(options: GuestOptions) {
    this.options = options;
    this.doc = options.document ?? document;
    this.root = options.root ?? this.doc.body;
    this.id = randomId();
  }

  /** Inject the sidebar frame, connect and start observing. */
  start(): void {
    if (this.frame) return;
    const doc = this.doc;
    this.renderer = createHighlightRenderer(doc, this.root);
    this.frame = new SidebarFrame(doc, {
      sidebarOrigin: this.options.sidebarOrigin,
      sidebarPath: this.options.sidebarPath ?? '/',
      open: this.options.open ?? true,
    });
    this.frame.onVisibility((open) => this.send({ type: 'sidebar.visibility', open }));
    this.connection = new GuestConnection({
      window: doc.defaultView as Window,
      sidebarWindow: () => this.frame?.contentWindow ?? null,
      sidebarOrigin: this.options.sidebarOrigin,
      guestId: this.id,
      capabilities: { highlights: this.renderer.technique },
      onMessage: (message) => this.handle(message),
      onConnected: () => this.onConnected(),
      ...(this.options.createChannel ? { createChannel: this.options.createChannel } : {}),
    });

    this.cleanups.push(
      observeMutations(this.root, {
        isOwned: (node) => this.isOwned(node),
        onChange: () => this.onMutation(),
        ...(this.options.mutationDebounceMs !== undefined
          ? { debounceMs: this.options.mutationDebounceMs }
          : {}),
      }),
      observeSelection(doc, {
        root: this.root,
        isOwned: (node) => this.isOwned(node),
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
    this.renderer?.dispose();
    this.frame?.remove();
    this.connection = undefined;
    this.renderer = undefined;
    this.frame = undefined;
    this.requests.clear();
    this.results.clear();
    this.ranges.clear();
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
    return [...this.results.values()];
  }

  // -------------------------------------------------------------------------

  private send(message: Parameters<GuestConnection['send']>[0]): void {
    this.connection?.send(message);
  }

  private isOwned(node: Node): boolean {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return element?.closest(`[${GUEST_ATTRIBUTE}]`) !== null && element !== null;
  }

  private currentScope(): AnchoringScope {
    this.scope ??= createScope(this.root);
    return this.scope;
  }

  private onConnected(): void {
    this.send({ type: 'document.report', document: collectDocument(this.doc) });
    this.send({ type: 'sidebar.visibility', open: this.sidebarOpen });
    if (this.requests.size > 0) this.send({ type: 'anchoring.results', results: this.anchorAll() });
  }

  private handle(message: SidebarMessage): void {
    switch (message.type) {
      case 'annotations.anchor':
        for (const request of message.requests) this.requests.set(request.id, request);
        this.send({
          type: 'anchoring.results',
          results: this.anchorAll(message.requests.map((r) => r.id)),
        });
        break;
      case 'annotations.unanchor':
        for (const id of message.ids) {
          this.requests.delete(id);
          this.results.delete(id);
          this.ranges.delete(id);
        }
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
  private anchorAll(ids?: string[]): AnchoringResult[] {
    this.scope = createScope(this.root);
    const scope = this.scope;
    const results: AnchoringResult[] = [];
    for (const id of ids ?? this.requests.keys()) {
      const request = this.requests.get(id);
      if (!request) continue;
      const targets = Array.isArray(request.target) ? request.target : [request.target];
      const ranges: Range[] = [];
      const perTarget = targets.map((target): TargetAnchoringResult => {
        const selectors = selectorsOfTarget(target);
        if (selectors.length === 0) return { state: 'anchored' };
        const result = anchor(scope, selectors, this.options.anchoring ?? {});
        if (result.state === 'anchored') {
          const dom = domRangeOf(scope, result.range);
          if (dom) ranges.push(dom);
          return { state: 'anchored', range: result.range, via: result.via, score: result.score };
        }
        if (result.state === 'ambiguous')
          return { state: 'ambiguous', candidates: result.candidates };
        return { state: 'orphaned', reason: result.reason };
      });
      const state = perTarget.some((t) => t.state === 'anchored')
        ? 'anchored'
        : perTarget.some((t) => t.state === 'ambiguous')
          ? 'ambiguous'
          : 'orphaned';
      const result: AnchoringResult = { id, state, targets: perTarget };
      this.results.set(id, result);
      this.ranges.set(id, ranges);
      results.push(result);
    }
    this.draw();
    return results;
  }

  private draw(): void {
    const entries: HighlightEntry[] = [];
    for (const [id, ranges] of this.ranges) if (ranges.length > 0) entries.push({ id, ranges });
    this.renderer?.set(entries);
    this.renderer?.focus(this.focused);
    this.index.set(entries);
  }

  /** After a DOM change: re-anchor everything and report what changed. */
  private onMutation(): void {
    const before = new Map([...this.results].map(([id, r]) => [id, JSON.stringify(r)]));
    const changed = this.anchorAll().filter((r) => before.get(r.id) !== JSON.stringify(r));
    if (changed.length > 0) this.send({ type: 'anchoring.results', results: changed });
  }

  private scrollTo(id: string): void {
    const range = this.ranges.get(id)?.[0];
    const element = range?.startContainer.parentElement;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.index.invalidate();
    this.renderer?.refresh();
  }

  private onSelection(range: Range | null): void {
    if (!range) {
      this.reportSelection(null);
      return;
    }
    const scope = this.currentScope();
    const textRange = textRangeOf(scope, range);
    const trimmed = textRange && trim(scope.map.text, textRange);
    if (!trimmed) {
      this.reportSelection(null);
      return;
    }
    const target: SpecificResource = {
      type: 'SpecificResource',
      source: this.doc.location.href,
      selector: describeTextRange(scope, trimmed),
    };
    this.reportSelection({ target, quote: textOfRange(scope.map.text, trimmed) });
  }

  private reportSelection(selection: GuestSelection | null): void {
    const key = selection ? JSON.stringify(selection) : null;
    if (key === this.lastSelection) return;
    this.lastSelection = key;
    this.send({ type: 'selection.changed', selection });
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.hoverFrame !== 0 || this.ranges.size === 0) return;
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
    if (this.isOwned(event.target as Node)) return;
    const ids = this.index.idsAt(event.clientX, event.clientY);
    if (ids.length > 0) this.send({ type: 'highlights.activated', ids });
  }
}

/** Drop collapsible whitespace and line feeds from both ends of a selection. */
function trim(text: string, range: TextRange): TextRange | undefined {
  const chars = [...textOfRange(text, range)];
  let start = 0;
  let end = chars.length;
  while (start < end && WHITESPACE.test(chars[start] as string)) start++;
  while (end > start && WHITESPACE.test(chars[end - 1] as string)) end--;
  if (start === end) return undefined;
  return { start: range.start + start, end: range.start + end };
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Math.random().toString(36).slice(2);
}
