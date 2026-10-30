import { describe, expect, it } from 'vitest';
import { parseEventStream, type ServerSentEvent } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ServerSentEvent[]> {
  const out: ServerSentEvent[] = [];
  for await (const event of parseEventStream(stream)) out.push(event);
  return out;
}

describe('parseEventStream', () => {
  it('parses events split across chunks and skips comments', async () => {
    const events = await collect(
      streamOf([
        ': connected\n\nevent: annotation.created\nid: 7\ndata: {"id":',
        '"a"}\n\n: keepalive\n\nevent: annotation.deleted\nid: 8\ndata: {"id":"a"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { event: 'annotation.created', id: '7', data: '{"id":"a"}' },
      { event: 'annotation.deleted', id: '8', data: '{"id":"a"}' },
    ]);
  });

  it('joins multi-line data and defaults the event name', async () => {
    const events = await collect(streamOf(['data: one\ndata: two\r\n\r\n']));
    expect(events).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });
});
