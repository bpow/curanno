/**
 * The sidebar iframe and its host element. The host sits in a closed
 * shadow root so page CSS does not reach it (style isolation only, not a
 * security boundary; ADR 0007) and is marked as the guest's own and not
 * annotatable, so the text model and the observers skip it. Once loaded,
 * the sidebar keeps a tab on the page's edge that shows and hides it, and
 * a handle on its own edge that resizes it.
 */
import { GUEST_ATTRIBUTE } from './highlights/types.js';

export const DEFAULT_SIDEBAR_WIDTH = 420;
export const MIN_SIDEBAR_WIDTH = 280;
/** The toggle tab's width, which the open sidebar always leaves on screen. */
const TAB_WIDTH = 32;
const KEY_STEP = 32;

const STYLE = `
:host { all: initial; position: fixed; top: 0; right: 0; width: 0; height: 100vh;
  overflow: visible; z-index: 2147483647; display: block; }
.panel { position: absolute; top: 0; right: 0; height: 100%; }
.panel.open { box-shadow: -2px 0 8px rgba(0, 0, 0, 0.25); }
iframe { display: block; border: 0; width: 100%; height: 100%; background: #fff; }
iframe[hidden], .handle[hidden] { display: none; }
.panel.resizing iframe { pointer-events: none; }
.tab { all: initial; box-sizing: border-box; position: absolute; top: 56px; right: 100%;
  width: ${TAB_WIDTH}px; height: 40px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; background: #1f4fb8; color: #fff; border: 1px solid #163a87; border-right: 0;
  border-radius: 6px 0 0 6px; box-shadow: -2px 1px 4px rgba(0, 0, 0, 0.25); }
.tab:hover { background: #163a87; }
.tab:focus-visible { outline: 3px solid #f2c94c; outline-offset: 1px; }
.tab svg { width: 18px; height: 18px; }
.handle { position: absolute; top: 0; left: -4px; width: 8px; height: 100%; cursor: ew-resize;
  touch-action: none; z-index: 1; }
.handle:hover, .handle:focus-visible, .panel.resizing .handle {
  outline: none; background: rgba(31, 79, 184, 0.55); }
@media (forced-colors: active) {
  .tab { forced-color-adjust: none; background: ButtonFace; color: ButtonText; border-color: ButtonText; }
  .tab:focus-visible { outline-color: Highlight; }
  .handle:hover, .handle:focus-visible, .panel.resizing .handle { background: Highlight; }
}
`;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Chevrons pointing the way the sidebar will move. */
const OPEN_ICON = 'M15 5 8 12l7 7';
const CLOSE_ICON = 'M9 5l7 7-7 7';

export interface SidebarFrameOptions {
  sidebarOrigin: string;
  sidebarPath: string;
  open: boolean;
}

export class SidebarFrame {
  readonly host: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  private readonly shadow: ShadowRoot;
  private readonly panel: HTMLElement;
  private readonly tab: HTMLButtonElement;
  private readonly tabIcon: SVGPathElement;
  private readonly handle: HTMLElement;
  private readonly listeners = new Set<(open: boolean) => void>();
  private readonly widthListeners = new Set<(width: number) => void>();
  /** The width last reported to the width listeners. */
  private reportedWidth: number | undefined;
  private readonly doc: Document;
  private isOpen: boolean;
  private requestedWidth = DEFAULT_SIDEBAR_WIDTH;
  /** The page element that last had focus, where focus goes back when the sidebar closes. */
  private lastFocused: HTMLElement | undefined;
  private readonly onFocusIn = (event: FocusEvent): void => {
    if (event.target instanceof HTMLElement && event.target !== this.host) {
      this.lastFocused = event.target;
    }
  };
  private readonly onResize = (): void => this.layout();

  constructor(doc: Document, options: SidebarFrameOptions) {
    const url = new URL(options.sidebarPath, options.sidebarOrigin);
    if (url.origin !== options.sidebarOrigin) {
      throw new Error(`sidebar path ${options.sidebarPath} leaves origin ${options.sidebarOrigin}`);
    }
    this.doc = doc;
    this.isOpen = options.open;
    doc.addEventListener('focusin', this.onFocusIn, true);
    doc.defaultView?.addEventListener('resize', this.onResize);
    this.host = doc.createElement('div');
    this.host.setAttribute(GUEST_ATTRIBUTE, 'sidebar');
    this.host.setAttribute('data-annotatable', 'false');
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    this.panel = doc.createElement('div');
    this.panel.className = 'panel';

    this.tab = doc.createElement('button');
    this.tab.type = 'button';
    this.tab.className = 'tab';
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    this.tabIcon = doc.createElementNS(SVG_NS, 'path');
    svg.appendChild(this.tabIcon);
    this.tab.appendChild(svg);
    this.tab.addEventListener('click', () => this.toggle());

    this.handle = doc.createElement('div');
    this.handle.className = 'handle';
    this.handle.tabIndex = 0;
    this.handle.setAttribute('role', 'separator');
    this.handle.setAttribute('aria-orientation', 'vertical');
    this.handle.setAttribute('aria-label', 'Resize annotations sidebar');
    this.handle.title = 'Drag to resize';
    this.handle.addEventListener('pointerdown', (event) => this.startResize(event));
    this.handle.addEventListener('keydown', (event) => this.onHandleKey(event));

    this.iframe = doc.createElement('iframe');
    this.iframe.title = 'Annotations';
    this.iframe.src = url.href;
    this.panel.append(this.tab, this.handle, this.iframe);
    this.shadow.append(style, this.panel);
    this.layout();
    doc.body.appendChild(this.host);
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** The sidebar's width in CSS pixels while open, after fitting it to the viewport. */
  get width(): number {
    const max = this.maxWidth();
    return Math.max(Math.min(MIN_SIDEBAR_WIDTH, max), Math.min(this.requestedWidth, max));
  }

  get contentWindow(): Window | null {
    return this.iframe.contentWindow;
  }

  setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    const focusInside = !open && this.shadow.activeElement === this.iframe;
    this.isOpen = open;
    this.layout();
    // Hiding the frame that has focus would leave keyboard users stranded in it.
    if (focusInside) this.returnFocus();
    for (const listener of this.listeners) listener(open);
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  /** Ask for a width; it is kept within the viewport and the minimum. */
  setWidth(width: number): void {
    this.requestedWidth = Math.round(width);
    this.layout();
  }

  private maxWidth(): number {
    return Math.max(0, (this.doc.defaultView?.innerWidth ?? DEFAULT_SIDEBAR_WIDTH) - TAB_WIDTH);
  }

  private layout(): void {
    const open = this.isOpen;
    const width = this.width;
    this.host.toggleAttribute('data-open', open);
    this.panel.classList.toggle('open', open);
    this.panel.style.width = open ? `${width}px` : '0';
    this.iframe.hidden = !open;
    this.handle.hidden = !open;
    const label = open ? 'Hide annotations' : 'Show annotations';
    this.tab.setAttribute('aria-label', label);
    this.tab.title = label;
    this.tabIcon.setAttribute('d', open ? CLOSE_ICON : OPEN_ICON);
    this.handle.setAttribute('aria-valuemin', String(Math.min(MIN_SIDEBAR_WIDTH, this.maxWidth())));
    this.handle.setAttribute('aria-valuemax', String(this.maxWidth()));
    this.handle.setAttribute('aria-valuenow', String(width));
    this.handle.setAttribute('aria-valuetext', `${width} pixels wide`);
    const occupied = open ? width : 0;
    if (occupied !== this.reportedWidth) {
      this.reportedWidth = occupied;
      for (const listener of this.widthListeners) listener(occupied);
    }
  }

  private startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const view = this.doc.defaultView;
    if (!view) return;
    const handle = this.handle;
    handle.setPointerCapture(event.pointerId);
    this.panel.classList.add('resizing');
    const move = (e: PointerEvent): void => this.setWidth(view.innerWidth - e.clientX);
    const end = (): void => {
      this.panel.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  private onHandleKey(event: KeyboardEvent): void {
    // The handle is the sidebar's left edge: moving it left widens the sidebar.
    const width = this.width;
    const next: Record<string, number> = {
      ArrowLeft: width + KEY_STEP,
      ArrowRight: width - KEY_STEP,
      Home: MIN_SIDEBAR_WIDTH,
      End: this.maxWidth(),
    };
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    this.setWidth(target);
  }

  private returnFocus(): void {
    this.iframe.blur();
    this.doc.defaultView?.focus();
    if (this.lastFocused?.isConnected) this.lastFocused.focus({ preventScroll: true });
  }

  onVisibility(listener: (open: boolean) => void): void {
    this.listeners.add(listener);
  }

  /** Called now and whenever the width the sidebar covers changes: 0 while closed. */
  onWidth(listener: (width: number) => void): void {
    this.widthListeners.add(listener);
    listener(this.reportedWidth ?? 0);
  }

  remove(): void {
    this.doc.removeEventListener('focusin', this.onFocusIn, true);
    this.doc.defaultView?.removeEventListener('resize', this.onResize);
    this.host.remove();
    this.listeners.clear();
    this.widthListeners.clear();
  }
}
