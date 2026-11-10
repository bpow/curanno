/**
 * Sign-in through the browser extension (ADR 0029). When the extension's
 * bridge runs in this frame, the provider's pages open in a window the
 * extension controls instead of a popup, so a page that sends
 * `Cross-Origin-Opener-Policy: same-origin` cannot break sign-in. The
 * authorization code comes back here and is exchanged by this origin, as
 * with the popup (ADR 0019).
 */
import {
  EXTENSION_BRIDGE,
  parseBridgeMessage,
  type BridgeNavigateMessage,
  type BridgeNavigatedMessage,
  type BridgeQueryMessage,
} from '@curanno/model';
import type { INavigator, IWindow, NavigateParams, NavigateResponse } from 'oidc-client-ts';

let redirectUri: string | undefined;
const pending = new Map<string, (message: BridgeNavigatedMessage) => void>();
let listening = false;

function post(message: BridgeQueryMessage | BridgeNavigateMessage): void {
  window.postMessage(message, window.location.origin);
}

function onMessage(event: MessageEvent): void {
  // Only this window can post as itself: the host page and other frames cannot.
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = parseBridgeMessage(event.data);
  if (message?.type === 'ready') redirectUri = message.redirectUri;
  if (message?.type === 'navigated') pending.get(message.id)?.(message);
}

/**
 * Starts listening for the bridge and asks whether it is there. The bridge
 * may load before or after this frame's script, so it announces itself on
 * start and also answers the query.
 */
export function listenForExtension(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', onMessage);
  post({ bridge: EXTENSION_BRIDGE, type: 'query' });
}

/** The extension's redirect URI, when its bridge has announced itself in this frame. */
export function extensionRedirectUri(): string | undefined {
  return redirectUri;
}

function navigate(url: string): Promise<NavigateResponse> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      pending.delete(id);
      if (message.url) resolve({ url: message.url });
      else reject(new Error(message.error ?? 'Sign-in through the extension failed'));
    });
    post({ bridge: EXTENSION_BRIDGE, type: 'navigate', id, url });
  });
}

/** Stands in for oidc-client-ts's popup navigator; the extension owns the window. */
export const extensionNavigator: INavigator = {
  prepare(): Promise<IWindow> {
    return Promise.resolve({
      navigate: (params: NavigateParams) => navigate(params.url),
      // The extension closes its window when the flow ends or the user closes it.
      close: () => undefined,
    });
  },
  callback(): Promise<void> {
    return Promise.reject(new Error('The extension handles its own callback'));
  },
};
