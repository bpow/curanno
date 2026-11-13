/**
 * The OpenAI-compatible chat completions call (ADR 0032). Plain `fetch`, no
 * SDK and no credential; the endpoint is one the deployment configured, and
 * the sidebar's CSP lets it reach no other.
 */
import type { JsonSchema } from '@curanno/model';
import type { ChatMessage } from './prompt.js';

export interface Endpoint {
  /** Base URL, for example `http://localhost:11434`; `/v1/chat/completions` is appended. */
  url: string;
  model: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  stream: false;
  response_format: {
    type: 'json_schema';
    json_schema: { name: string; strict: boolean; schema: JsonSchema };
  };
}

export class EndpointError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function completionsUrl(endpoint: Endpoint): string {
  return `${endpoint.url.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;
}

export function completionRequest(
  endpoint: Endpoint,
  messages: ChatMessage[],
  schema: JsonSchema,
): CompletionRequest {
  return {
    model: endpoint.model,
    messages,
    temperature: 0,
    stream: false,
    // Not strict: strict mode demands every property be required, which profiles' optional fields are not.
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'suggestions', strict: false, schema },
    },
  };
}

/** Send one request and return the message content. */
export async function complete(
  endpoint: Endpoint,
  request: CompletionRequest,
  options: { fetch?: typeof fetch; signal?: AbortSignal | undefined } = {},
): Promise<string> {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImpl(completionsUrl(endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new EndpointError(`could not reach ${endpoint.url}: ${(err as Error).message}`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new EndpointError(
      `${endpoint.url} answered ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
    );
  }
  const body = (await response.json().catch(() => undefined)) as
    { choices?: { message?: { content?: unknown } }[] } | undefined;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new EndpointError(`${endpoint.url} returned no message content`);
  }
  return content;
}

export interface RawSuggestion {
  quote: string;
  value: unknown;
}

/** The suggestions in a model's answer, or undefined when it is not the expected JSON. */
export function parseAnswer(content: string): RawSuggestion[] | undefined {
  // Some models wrap JSON in a code fence even under a response format.
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const list = (parsed as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return undefined;
  return list.filter(
    (s): s is RawSuggestion =>
      typeof s === 'object' && s !== null && typeof (s as RawSuggestion).quote === 'string',
  );
}
