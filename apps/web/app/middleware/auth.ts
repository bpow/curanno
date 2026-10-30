import { defineNuxtRouteMiddleware, navigateTo, useNuxtApp } from '#imports';
import type { AuthStore } from '../auth/store';

/** Pages that need a signed-in user. Anonymous visitors go through the provider first. */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  const auth = useNuxtApp().$auth as AuthStore;
  await auth.ready();
  if (auth.status.value !== 'authenticated') {
    return navigateTo({ path: '/login', query: { returnTo: to.fullPath } });
  }
});
