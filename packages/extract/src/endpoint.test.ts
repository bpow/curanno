import { describe, expect, it } from 'vitest';
import {
  EndpointError,
  complete,
  completionRequest,
  completionsUrl,
  parseAnswer,
} from './endpoint.js';

describe('completionsUrl', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434/v1/chat/completions'],
    ['http://localhost:11434/', 'http://localhost:11434/v1/chat/completions'],
    ['http://localhost:8000/v1', 'http://localhost:8000/v1/chat/completions'],
    ['https://llm.example/proxy/', 'https://llm.example/proxy/v1/chat/completions'],
  ])('%s', (url, expected) => {
    expect(completionsUrl({ url, model: 'm' })).toBe(expected);
  });
});

describe('parseAnswer', () => {
  it('reads the suggestions list, with or without a code fence', () => {
    const json = '{"suggestions":[{"quote":"a b c d","value":{}}]}';
    expect(parseAnswer(json)).toEqual([{ quote: 'a b c d', value: {} }]);
    expect(parseAnswer('```json\n' + json + '\n```')).toHaveLength(1);
  });

  it('drops entries without a quote and refuses other shapes', () => {
    expect(parseAnswer('{"suggestions":[{"value":{}},{"quote":"x"}]}')).toEqual([{ quote: 'x' }]);
    expect(parseAnswer('[]')).toBeUndefined();
    expect(parseAnswer('{"suggestions": {}}')).toBeUndefined();
    expect(parseAnswer('nope')).toBeUndefined();
  });
});

describe('complete', () => {
  const endpoint = { url: 'http://localhost:1', model: 'm' };
  const request = completionRequest(endpoint, [], {});

  it('reports an unreachable endpoint', async () => {
    const failing = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    await expect(complete(endpoint, request, { fetch: failing })).rejects.toThrow(
      /could not reach http:\/\/localhost:1: fetch failed/,
    );
  });

  it('reports an error status with the start of the body', async () => {
    const failing = (() =>
      Promise.resolve(new Response('model "m" not found', { status: 404 }))) as typeof fetch;
    const error = await complete(endpoint, request, { fetch: failing }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EndpointError);
    expect((error as EndpointError).status).toBe(404);
    expect((error as Error).message).toContain('model "m" not found');
  });

  it("takes a reasoning model's answer from the reasoning field when content is empty", async () => {
    const reply = (message: Record<string, unknown>) =>
      (() => Promise.resolve(Response.json({ choices: [{ message }] }))) as typeof fetch;
    const json = '{"suggestions":[]}';
    expect(
      await complete(endpoint, request, { fetch: reply({ content: '', reasoning_content: json }) }),
    ).toBe(json);
    expect(
      await complete(endpoint, request, {
        fetch: reply({ content: json, reasoning: 'Let me think' }),
      }),
    ).toBe(json);
    await expect(complete(endpoint, request, { fetch: reply({ content: '' }) })).rejects.toThrow(
      /no message content/,
    );
  });
});
