/**
 * The content script: one guest per frame, in the extension's isolated
 * world (ADR 0023). The service worker injects it into every frame of a tab
 * where the guest is on; a frame that already has one ignores the second
 * injection. The top frame's guest is the host and shows the sidebar;
 * other frames connect to that sidebar themselves (ADR 0024). The
 * sidebar's and the viewer's frames, and every frame inside them, are
 * left alone.
 */
import { Guest } from '@curanno/guest';
import type { AnchorCountMessage } from './messages.js';
import { excludedOrigins, loadSettings, sidebarLocation, validateSettings } from './settings.js';

interface ExtensionGuest {
  stop(): void;
}

declare global {
  interface Window {
    __curannoExtension?: ExtensionGuest;
  }
}

function report(count: number): void {
  const message: AnchorCountMessage = { type: 'anchor-count', count };
  // The worker may be restarting; the next change reports again.
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function main(): Promise<void> {
  if (window.__curannoExtension) return;
  // Claimed before the await so that a second injection meanwhile stops here.
  const state: { guest?: Guest; stopped: boolean } = { stopped: false };
  window.__curannoExtension = {
    stop() {
      state.stopped = true;
      state.guest?.destroy();
      delete window.__curannoExtension;
    },
  };
  const settings = await loadSettings();
  if (state.stopped) return;
  if (Object.keys(validateSettings(settings)).length > 0) {
    console.error('[curanno extension] the settings are not valid; see the options page');
    return;
  }
  // Frames inside the sidebar, such as the identity provider's, are excluded too.
  const excluded = excludedOrigins(settings);
  if (
    [location.origin, ...Array.from(location.ancestorOrigins)].some((o) => excluded.includes(o))
  ) {
    return;
  }
  if (!document.body) return;
  state.guest = new Guest({
    ...sidebarLocation(settings),
    role: window.parent === window ? 'host' : 'sub',
    onAnchorCount: report,
  });
  state.guest.start();
}

void main();
