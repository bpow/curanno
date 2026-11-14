/**
 * A fake OpenAI-compatible endpoint, as a `fetch` implementation, for tests
 * of the pipeline and of its callers. The handler sees each request and
 * returns the message content, or a `Response` to send as it is.
 */
import type { CompletionRequest } from './endpoint.js';

export type FakeHandler = (
  request: CompletionRequest,
  call: number,
) => string | Response | Promise<string | Response>;

export interface FakeEndpoint {
  fetch: typeof fetch;
  requests: CompletionRequest[];
}

/** Message content answering with these suggestions. */
export function answer(suggestions: { quote: string; value: unknown }[]): string {
  return JSON.stringify({ suggestions });
}

export function createFakeEndpoint(handler: FakeHandler): FakeEndpoint {
  const requests: CompletionRequest[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/v1/chat/completions') || init?.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const request = JSON.parse(init.body as string) as CompletionRequest;
    requests.push(request);
    const result = await handler(request, requests.length - 1);
    if (result instanceof Response) return result;
    return Response.json({
      id: `fake-${requests.length}`,
      object: 'chat.completion',
      model: request.model,
      choices: [
        { index: 0, message: { role: 'assistant', content: result }, finish_reason: 'stop' },
      ],
    });
  };
  return { fetch: fakeFetch, requests };
}

/** The document text a request carried, between its `<document>` tags. */
export function documentOf(request: CompletionRequest): string {
  const user = request.messages.find((m) => m.role === 'user')?.content ?? '';
  return /<document>\n([\s\S]*)\n<\/document>/.exec(user)?.[1] ?? '';
}
