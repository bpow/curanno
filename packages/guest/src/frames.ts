/**
 * Same-origin frames of the page get a guest of their own: the host injects
 * the bundle into every `iframe` whose document it can reach, now and as
 * frames are added or navigate. The injected copy sees it is not the top
 * window and connects through the host (`rpc/sub-connection.ts`).
 * Cross-origin frames cannot be reached; their pages load the guest
 * themselves (our PDF viewer does).
 */
import { GUEST_ATTRIBUTE } from './highlights/types.js';

export interface FrameInjectorOptions {
  document: Document;
  /** The bundle's own URL, as the script element it was loaded from had it. */
  bundleUrl: string;
  sidebarOrigin: string;
  sidebarPath: string;
}

export const INJECTED_ATTRIBUTE = 'data-scale-guest-injected';

/** The script element the bundle is injected with, in a frame's document. */
export function injectionScript(doc: Document, options: FrameInjectorOptions): HTMLScriptElement {
  const script = doc.createElement('script');
  script.src = options.bundleUrl;
  script.async = true;
  script.setAttribute('data-sidebar-origin', options.sidebarOrigin);
  script.setAttribute('data-sidebar-path', options.sidebarPath);
  script.setAttribute(INJECTED_ATTRIBUTE, '');
  return script;
}

/** Inject into one frame when its document is reachable and has no guest yet. */
export function injectIntoFrame(frame: HTMLIFrameElement, options: FrameInjectorOptions): boolean {
  let doc: Document | null;
  try {
    doc = frame.contentDocument;
  } catch {
    return false;
  }
  if (!doc || !doc.body || doc.readyState === 'loading') return false;
  if (doc.querySelector(`script[${INJECTED_ATTRIBUTE}], script[data-sidebar-origin]`)) return false;
  doc.body.appendChild(injectionScript(doc, options));
  return true;
}

/** Start injecting into the page's same-origin frames; returns the function that stops. */
export function injectFrames(options: FrameInjectorOptions): () => void {
  const doc = options.document;
  const view = doc.defaultView as Window & typeof globalThis;
  const seen = new WeakSet<HTMLIFrameElement>();

  const consider = (frame: HTMLIFrameElement): void => {
    if (frame.closest(`[${GUEST_ATTRIBUTE}]`)) return;
    if (!seen.has(frame)) {
      seen.add(frame);
      // A frame that navigates gets a fresh document, so inject again on load.
      frame.addEventListener('load', () => injectIntoFrame(frame, options));
    }
    injectIntoFrame(frame, options);
  };
  const scan = (root: ParentNode): void => {
    for (const frame of Array.from(root.querySelectorAll('iframe'))) consider(frame);
  };

  scan(doc);
  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element;
        if (element.tagName === 'IFRAME') consider(element as HTMLIFrameElement);
        else scan(element);
      }
    }
  });
  observer.observe(doc, { childList: true, subtree: true });
  return () => observer.disconnect();
}
