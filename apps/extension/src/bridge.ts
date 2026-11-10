/**
 * The sign-in bridge (ADR 0029), injected into the sidebar's frame only. It
 * tells the sidebar the extension is here and relays its request to open the
 * provider's page to the service worker, which runs
 * `chrome.identity.launchWebAuthFlow`. It sees the URL the flow ends on (an
 * authorization code, or a sign-out) and nothing else; the PKCE verifier and
 * the tokens stay in the sidebar.
 */
import {
  EXTENSION_BRIDGE,
  extensionRedirectUri,
  parseBridgeMessage,
  type BridgeNavigatedMessage,
  type BridgeReadyMessage,
} from '@curanno/model';
import { isWebAuthResult, type WebAuthRequest } from './messages.js';
import { isSidebarUrl, loadSettings } from './settings.js';

declare global {
  interface Window {
    __curannoBridge?: true;
  }
}

function post(message: BridgeReadyMessage | BridgeNavigatedMessage): void {
  window.postMessage(message, window.location.origin);
}

async function relay(id: string, url: string): Promise<void> {
  const request: WebAuthRequest = { type: 'web-auth', url };
  let reply: BridgeNavigatedMessage;
  try {
    const result: unknown = await chrome.runtime.sendMessage(request);
    reply = isWebAuthResult(result)
      ? { bridge: EXTENSION_BRIDGE, type: 'navigated', id, ...result }
      : { bridge: EXTENSION_BRIDGE, type: 'navigated', id, error: 'The extension did not answer' };
  } catch (err) {
    reply = {
      bridge: EXTENSION_BRIDGE,
      type: 'navigated',
      id,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  post(reply);
}

async function main(): Promise<void> {
  if (window.__curannoBridge) return;
  window.__curannoBridge = true;
  if (window.parent === window) return;
  if (!isSidebarUrl(await loadSettings(), location.href)) return;
  const ready: BridgeReadyMessage = {
    bridge: EXTENSION_BRIDGE,
    type: 'ready',
    redirectUri: extensionRedirectUri(chrome.runtime.id),
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = parseBridgeMessage(event.data);
    if (message?.type === 'query') post(ready);
    if (message?.type === 'navigate') void relay(message.id, message.url);
  });
  post(ready);
}

void main();
