import { createApiClient, type ApiClient } from '@scale/api-client';

export interface Call {
  method: string;
  url: URL;
  body: unknown;
}

export type Route = (call: Call) => Response | undefined;

export interface FakeApi {
  client: ApiClient;
  calls: Call[];
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

export function problem(status: number, title: string, detail?: string): Response {
  return new Response(JSON.stringify({ status, title, detail }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

export const noContent = (): Response => new Response(null, { status: 204 });

/**
 * A client whose fetch answers from `route`, so components exercise the
 * generated client end to end without a server. Provide `client` under
 * `API_KEY` when mounting.
 */
export function fakeApi(route: Route): FakeApi {
  const calls: Call[] = [];
  const client = createApiClient({
    baseUrl: 'http://api.test',
    fetch: async (input) => {
      const request = input as Request;
      const text = await request.text();
      const call: Call = {
        method: request.method,
        url: new URL(request.url),
        body: text ? (JSON.parse(text) as unknown) : undefined,
      };
      calls.push(call);
      return route(call) ?? problem(404, 'Not Found', `${call.method} ${call.url.pathname}`);
    },
  });
  return { client, calls };
}
