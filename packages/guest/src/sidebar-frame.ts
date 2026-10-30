/**
 * The sidebar iframe and its host element. The host sits in a closed
 * shadow root so page CSS does not reach it (style isolation only, not a
 * security boundary; ADR 0007) and is marked as the guest's own and not
 * annotatable, so the text model and the observers skip it.
 */
import { GUEST_ATTRIBUTE } from './highlights/types.js';

const STYLE = `
:host { all: initial; position: fixed; top: 0; right: 0; height: 100vh;
  width: min(420px, 100vw); z-index: 2147483647; display: block;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.25); }
:host([hidden]) { display: none; }
iframe { border: 0; width: 100%; height: 100%; background: #fff; }
`;

export interface SidebarFrameOptions {
  sidebarOrigin: string;
  sidebarPath: string;
  open: boolean;
}

export class SidebarFrame {
  readonly host: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  private readonly listeners = new Set<(open: boolean) => void>();

  constructor(doc: Document, options: SidebarFrameOptions) {
    const url = new URL(options.sidebarPath, options.sidebarOrigin);
    if (url.origin !== options.sidebarOrigin) {
      throw new Error(`sidebar path ${options.sidebarPath} leaves origin ${options.sidebarOrigin}`);
    }
    this.host = doc.createElement('div');
    this.host.setAttribute(GUEST_ATTRIBUTE, 'sidebar');
    this.host.setAttribute('data-annotatable', 'false');
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);
    this.iframe = doc.createElement('iframe');
    this.iframe.title = 'Annotations';
    this.iframe.src = url.href;
    shadow.appendChild(this.iframe);
    this.host.hidden = !options.open;
    doc.body.appendChild(this.host);
  }

  get open(): boolean {
    return !this.host.hidden;
  }

  get contentWindow(): Window | null {
    return this.iframe.contentWindow;
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.host.hidden = !open;
    for (const listener of this.listeners) listener(open);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  onVisibility(listener: (open: boolean) => void): void {
    this.listeners.add(listener);
  }

  remove(): void {
    this.host.remove();
    this.listeners.clear();
  }
}
