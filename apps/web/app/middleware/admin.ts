import {
  abortNavigation,
  createError,
  defineNuxtRouteMiddleware,
  navigateTo,
  useNuxtApp,
} from '#imports';
import type { AuthStore } from '../auth/store';

/** Pages for platform administrators, by the `isAdmin` flag the API reports for the caller. */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  const auth = useNuxtApp().$auth as AuthStore;
  await auth.ready();
  if (auth.status.value !== 'authenticated') {
    return navigateTo({ path: '/login', query: { returnTo: to.fullPath } });
  }
  if (!auth.me.value) {
    return abortNavigation(
      createError({ statusCode: 503, statusMessage: 'Your account could not be loaded' }),
    );
  }
  if (!auth.me.value.isAdmin) {
    return abortNavigation(createError({ statusCode: 403, statusMessage: 'Administrators only' }));
  }
});
