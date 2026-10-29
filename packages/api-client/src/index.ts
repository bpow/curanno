/**
 * Client for the platform API. `schema.ts` is generated from
 * apps/api/openapi.yaml by `pnpm generate` and checked for drift in CI;
 * everything hand-written lives here.
 */
import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';

export type * from './schema.js';

export interface ApiClientOptions {
  /** Origin and base path of the API, for example `https://annotations.example`. */
  baseUrl: string;
  /** Returns the bearer token for a request, or undefined for an anonymous request. */
  token?: () => string | undefined | Promise<string | undefined>;
  /** Replacement for the global fetch, for tests and non-browser hosts. */
  fetch?: typeof globalThis.fetch;
}

export type ApiClient = Client<paths>;

/** The content type the W3C protocol uses for annotations. */
export const ANNOTATION_CONTENT_TYPE = 'application/ld+json';

export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (options.token) {
    const getToken = options.token;
    const auth: Middleware = {
      async onRequest({ request }) {
        const token = await getToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      },
    };
    client.use(auth);
  }
  return client;
}
