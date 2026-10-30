import type { ApiClient } from '@curanno/api-client';
import { inject, type InjectionKey } from 'vue';

/**
 * The one API client (ADR 0002), provided to the component tree by the auth
 * plugin. Tests provide a client over a fake fetch under the same key.
 */
export const API_KEY: InjectionKey<ApiClient> = Symbol('api');

export function useApi(): ApiClient {
  const api = inject(API_KEY, null);
  if (!api) throw new Error('No API client is provided; the auth plugin runs in the browser only');
  return api;
}
