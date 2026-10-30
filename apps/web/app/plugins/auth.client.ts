import { createApiClient } from '@curanno/api-client';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import { API_KEY } from '../api/client';
import { createAuthStore } from '../auth/store';
import { createUserManager } from '../auth/user-manager';

/**
 * Browser only: the session and the API client exist where the token is.
 * Nothing on the server knows who the user is (ADR 0009).
 */
export default defineNuxtPlugin((nuxtApp) => {
  const { public: config } = useRuntimeConfig();
  const auth = createAuthStore(
    createUserManager({
      issuer: config.oidcIssuer,
      clientId: config.oidcClientId,
      origin: window.location.origin,
    }),
  );
  const api = createApiClient({ baseUrl: config.apiBase, token: () => auth.token() });
  nuxtApp.vueApp.provide(API_KEY, api);
  void auth.init(api);
  return { provide: { auth } };
});
