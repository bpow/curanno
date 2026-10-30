/**
 * Subscribes to `/x/events` for one document and keeps the subscription
 * alive: on any disconnection it reconnects with the last event id, so
 * nothing is missed while the connection was down.
 */
import type { Annotation } from '@scale/api-client';
import { useApi } from '../api/client';
import { parseEventStream } from './sse';

export type LiveStatus = 'connecting' | 'open' | 'retrying' | 'closed';

export interface AnnotationEvent {
  kind: 'created' | 'updated' | 'deleted';
  id: string;
  annotation?: Annotation;
}

export interface SubscribeOptions {
  uri: string;
  lastEventId?: string;
  onEvent(event: AnnotationEvent, eventId: string | undefined): void;
  onStatus?(status: LiveStatus): void;
  signal: AbortSignal;
  /** Delay before the first reconnection; doubles up to 30 s. */
  retryMs?: number;
}

const EVENT_PREFIX = 'annotation.';

export async function subscribeAnnotationEvents(options: SubscribeOptions): Promise<void> {
  const { signal } = options;
  let lastEventId = options.lastEventId;
  let delay = options.retryMs ?? 1000;
  const status = (s: LiveStatus) => options.onStatus?.(s);

  while (!signal.aborted) {
    status(lastEventId === undefined ? 'connecting' : 'retrying');
    try {
      const { data, response } = await useApi().GET('/x/events', {
        params: {
          query: { uri: options.uri },
          header: lastEventId !== undefined ? { 'Last-Event-ID': lastEventId } : {},
        },
        parseAs: 'stream',
        signal,
      });
      if (!response.ok || !data) throw new Error(`event stream answered ${response.status}`);
      status('open');
      delay = options.retryMs ?? 1000;
      for await (const message of parseEventStream(data)) {
        if (!message.event.startsWith(EVENT_PREFIX)) continue;
        const kind = message.event.slice(EVENT_PREFIX.length) as AnnotationEvent['kind'];
        const payload = JSON.parse(message.data) as { id: string; annotation?: Annotation };
        if (message.id !== undefined) lastEventId = message.id;
        options.onEvent(
          {
            kind,
            id: payload.id,
            ...(payload.annotation ? { annotation: payload.annotation } : {}),
          },
          lastEventId,
        );
      }
    } catch {
      // Falls through to the retry below; an abort ends the loop.
    }
    if (signal.aborted) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    delay = Math.min(delay * 2, 30_000);
  }
  status('closed');
}
