import { useNuxtApp } from '#imports';
import type { AuthStore } from '../auth/store';

/** The session store the auth plugin provides; browser only. */
export function useAuth(): AuthStore {
  return useNuxtApp().$auth;
}
