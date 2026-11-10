/**
 * OpenID Connect against the configured issuer (ADR 0005): Authorization
 * Code with PKCE, tokens kept in this origin's sessionStorage and never
 * handed to the host page or the guest (ADR 0007). The sidebar normally runs
 * in an iframe, where the provider's login page cannot be shown (it forbids
 * framing), so a framed sidebar signs in through a popup window and a
 * top-level one (development, tests) through a redirect.
 */
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { config } from '../config';
import { extensionNavigator } from './extension';

/** The sidebar's own base URL, where the provider redirects back to. */
export function appBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * With `extensionRedirectUri`, a manager whose popup sign-in and sign-out run
 * through the extension (ADR 0029). It shares the stores with the main one, so
 * the tokens it obtains are the main manager's next `getUser()`; renewal is
 * left to the main manager.
 */
export function createUserManager(extensionRedirectUri?: string): UserManager {
  const base = appBaseUrl();
  const popupRedirectUri = extensionRedirectUri ?? new URL('popup-callback.html', base).href;
  return new UserManager(
    {
      authority: config.oidc.issuer,
      client_id: config.oidc.clientId,
      response_type: 'code',
      // Zitadel, Okta, Auth0 and Entra ID issue refresh tokens only for offline_access.
      scope: 'openid profile email offline_access',
      redirect_uri: base,
      post_logout_redirect_uri: base,
      popup_redirect_uri: popupRedirectUri,
      popup_post_logout_redirect_uri: popupRedirectUri,
      silent_redirect_uri: new URL('silent-renew.html', base).href,
      automaticSilentRenew: !extensionRedirectUri,
      // Where third-party cookies are blocked the provider never answers the
      // hidden frame; give up before the user notices a late sign-in.
      silentRequestTimeoutInSeconds: 5,
      // Tokens live in sessionStorage of this origin only. The sign-in state
      // (PKCE verifier, no tokens) uses localStorage so that the popup and
      // silent-renew windows can complete the exchange.
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      stateStore: new WebStorageStateStore({ store: window.localStorage }),
    },
    undefined,
    extensionRedirectUri ? extensionNavigator : undefined,
  );
}
