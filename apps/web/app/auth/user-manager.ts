/**
 * OpenID Connect against the configured issuer (ADR 0005): Authorization
 * Code with PKCE as a public client, the same arrangement as the sidebar
 * (ADR 0019). Tokens stay in this origin's sessionStorage and leave the
 * browser only as `Authorization` headers on API requests.
 */
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

export interface OidcOptions {
  issuer: string;
  clientId: string;
  /** This site's origin, where the provider redirects back to. */
  origin: string;
}

export const CALLBACK_PATH = '/auth/callback';

export function createUserManager(options: OidcOptions): UserManager {
  return new UserManager({
    authority: options.issuer,
    client_id: options.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: new URL(CALLBACK_PATH, options.origin).href,
    post_logout_redirect_uri: new URL('/', options.origin).href,
    // Renewal uses the refresh token; there is no hidden-iframe renewal.
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}
