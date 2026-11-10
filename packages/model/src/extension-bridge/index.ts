/**
 * The browser extension's sign-in bridge (ADR 0029). The extension runs a
 * small content script in the sidebar's own frame; the sidebar asks it to
 * open the provider's authorization or end-session URL with
 * `chrome.identity.launchWebAuthFlow`, which a page's
 * Cross-Origin-Opener-Policy cannot cut off the way it does a popup.
 *
 * Both sides post to the sidebar's own window and accept a message only
 * when `event.source` is that window and `event.origin` its origin. The host
 * page and other frames can post to the sidebar but never as the sidebar
 * itself, and cannot listen on its window.
 */

export const EXTENSION_BRIDGE = 'curanno/extension-bridge';

/** Sidebar → bridge: is an extension here? */
export interface BridgeQueryMessage {
  bridge: typeof EXTENSION_BRIDGE;
  type: 'query';
}

/** Bridge → sidebar, on start and in answer to a query. */
export interface BridgeReadyMessage {
  bridge: typeof EXTENSION_BRIDGE;
  type: 'ready';
  /** `https://<extension id>.chromiumapp.org/`, to register with the provider. */
  redirectUri: string;
}

/** Sidebar → bridge: open this URL and report where the provider sends the browser back. */
export interface BridgeNavigateMessage {
  bridge: typeof EXTENSION_BRIDGE;
  type: 'navigate';
  id: string;
  url: string;
}

/** Bridge → sidebar: the URL the flow ended on, or why it did not. */
export interface BridgeNavigatedMessage {
  bridge: typeof EXTENSION_BRIDGE;
  type: 'navigated';
  id: string;
  url?: string;
  error?: string;
}

export type BridgeMessage =
  BridgeQueryMessage | BridgeReadyMessage | BridgeNavigateMessage | BridgeNavigatedMessage;

/** The redirect URI Chromium intercepts for an extension id, as `chrome.identity.getRedirectURL()` gives it. */
export function extensionRedirectUri(extensionId: string): string {
  return `https://${extensionId}.chromiumapp.org/`;
}

const REDIRECT_URI = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/;

export function isExtensionRedirectUri(value: string): boolean {
  return REDIRECT_URI.test(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** The message typed, or undefined for anything that is not a well-formed bridge message. */
export function parseBridgeMessage(value: unknown): BridgeMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const m = value as Record<string, unknown>;
  if (m['bridge'] !== EXTENSION_BRIDGE) return undefined;
  switch (m['type']) {
    case 'query':
      return { bridge: EXTENSION_BRIDGE, type: 'query' };
    case 'ready':
      return isString(m['redirectUri']) && isExtensionRedirectUri(m['redirectUri'])
        ? { bridge: EXTENSION_BRIDGE, type: 'ready', redirectUri: m['redirectUri'] }
        : undefined;
    case 'navigate':
      return isString(m['id']) && isString(m['url'])
        ? { bridge: EXTENSION_BRIDGE, type: 'navigate', id: m['id'], url: m['url'] }
        : undefined;
    case 'navigated': {
      if (!isString(m['id'])) return undefined;
      const url = isString(m['url']) ? m['url'] : undefined;
      const error = isString(m['error']) ? m['error'] : undefined;
      if (url === undefined && error === undefined) return undefined;
      return {
        bridge: EXTENSION_BRIDGE,
        type: 'navigated',
        id: m['id'],
        ...(url !== undefined ? { url } : {}),
        ...(error !== undefined ? { error } : {}),
      };
    }
    default:
      return undefined;
  }
}
