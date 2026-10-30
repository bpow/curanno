/**
 * Entry point of the self-contained bundle the bookmarklet injects. It
 * installs one guest per frame: a second injection toggles the sidebar
 * instead. In the top frame the guest is the host, holding the sidebar and
 * injecting this same bundle into same-origin frames; in any other frame
 * it is a guest that connects through the host. The global it leaves
 * exposes nothing but version, toggle and teardown; the page can remove
 * the frame anyway, so hiding those would protect nothing (ADR 0007).
 */
import { GUEST_GLOBAL } from './bookmarklet.js';
import { readConfig } from './config.js';
import { Guest } from './guest.js';

export const GUEST_VERSION = '0.1.0';

export interface GuestHandle {
  readonly version: string;
  toggleSidebar(): void;
  destroy(): void;
}

declare global {
  interface Window {
    [GUEST_GLOBAL]?: GuestHandle;
  }
}

function main(): void {
  const existing = window[GUEST_GLOBAL];
  if (existing) {
    existing.toggleSidebar();
    return;
  }
  const config = readConfig(document.currentScript);
  if (typeof config === 'string') {
    console.error(`[scale guest] ${config}`);
    return;
  }
  const guest = new Guest({
    ...config,
    role: window.parent === window ? 'host' : 'sub',
  });
  guest.start();
  const handle: GuestHandle = Object.freeze({
    version: GUEST_VERSION,
    toggleSidebar: () => guest.toggleSidebar(),
    destroy: () => {
      guest.destroy();
      delete window[GUEST_GLOBAL];
    },
  });
  Object.defineProperty(window, GUEST_GLOBAL, {
    value: handle,
    configurable: true,
    writable: false,
  });
}

main();
