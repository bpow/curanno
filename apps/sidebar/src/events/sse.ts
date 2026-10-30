/**
 * A parser for `text/event-stream` bodies, so the event stream can be read
 * through the generated client (which can send the bearer token and the
 * `Last-Event-ID` header, unlike EventSource).
 */
export interface ServerSentEvent {
  event: string;
  id?: string;
  data: string;
}

export async function* parseEventStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let id: string | undefined;
  let data: string[] = [];

  const flush = (): ServerSentEvent | undefined => {
    if (data.length === 0) {
      event = '';
      return undefined;
    }
    const out: ServerSentEvent = {
      event: event || 'message',
      data: data.join('\n'),
      ...(id !== undefined ? { id } : {}),
    };
    event = '';
    data = [];
    return out;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.search(/\r\n|\n|\r/)) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(
          newline + (buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1),
        );
        if (line === '') {
          const out = flush();
          if (out) yield out;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id' && !value.includes('\0')) id = value;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
