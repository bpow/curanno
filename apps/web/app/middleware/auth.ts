import { defineNuxtRouteMiddleware, navigateTo, useNuxtApp } from '#imports';

/** Pages that need a signed-in user. Anonymous visitors go through the provider first. */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  const auth = useNuxtApp().$auth;
  await auth.ready();
  if (auth.status.value !== 'authenticated') {
    return navigateTo({ path: '/login', query: { returnTo: to.fullPath } });
  }
});
