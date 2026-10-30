import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeApi } from '../test/fake-api';
import { subscribeAnnotationEvents, type AnnotationEvent } from './subscribe';

function eventStream(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('subscribeAnnotationEvents', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('resumes with Last-Event-ID after the stream ends', async () => {
    let connections = 0;
    const api = installFakeApi(() => {
      connections++;
      if (connections === 1) {
        return eventStream('event: annotation.created\nid: 3\ndata: {"id":"a"}\n\n');
      }
      return eventStream('event: annotation.deleted\nid: 4\ndata: {"id":"a"}\n\n');
    });
    const seen: [AnnotationEvent, string | undefined][] = [];
    const controller = new AbortController();
    const done = subscribeAnnotationEvents({
      uri: 'https://example.org/p',
      retryMs: 1,
      signal: controller.signal,
      onEvent: (event, id) => {
        seen.push([event, id]);
        if (seen.length === 2) controller.abort();
      },
    });
    await done;
    expect(seen).toEqual([
      [{ kind: 'created', id: 'a' }, '3'],
      [{ kind: 'deleted', id: 'a' }, '4'],
    ]);
    expect(api.calls[0]?.headers.get('last-event-id')).toBeNull();
    expect(api.calls[1]?.headers.get('last-event-id')).toBe('3');
    expect(api.calls[0]?.url.searchParams.get('uri')).toBe('https://example.org/p');
  });
});
