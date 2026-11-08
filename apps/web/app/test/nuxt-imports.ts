/**
 * Stand-ins for the few Nuxt functions pages import from `#imports`, for
 * tests where no Nuxt runtime exists: vitest.config.ts aliases `#imports`
 * here. A test sets the route's query with `setRouteQuery`.
 */
import { reactive } from 'vue';

const route = reactive<{ query: Record<string, string | undefined> }>({ query: {} });

export function setRouteQuery(query: Record<string, string | undefined>): void {
  route.query = query;
}

export const useRoute = (): typeof route => route;
export const definePageMeta = (): void => undefined;
export const useHead = (): void => undefined;
