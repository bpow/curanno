/**
 * LISTEN/NOTIFY bridge (ADR 0004). One dedicated connection listens on the
 * `annotation_events` channel that the trigger in migration 0006 notifies;
 * subscribers (the server-sent events handler) receive each payload and
 * decide, per subscriber, whether the caller may see it. Reconnects after
 * connection loss; replicas each run their own bridge.
 */
import pg from 'pg';
import type { AnnotationEventKind } from '../db/index.js';

export interface EventPayload {
  id: number;
  annotation_id: string;
  document_id: string | null;
  kind: AnnotationEventKind;
}

export type EventListener = (event: EventPayload) => void;

export const EVENT_CHANNEL = 'annotation_events';

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export class EventBridge {
  private client: pg.Client | undefined;
  private listeners = new Set<EventListener>();
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly connectionString: string,
    private readonly log: Logger,
    private readonly reconnectDelayMs = 1000,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = undefined;
    if (client) {
      client.removeAllListeners('error');
      client.on('error', () => undefined);
      await client.end().catch(() => undefined);
    }
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      if (msg.channel !== EVENT_CHANNEL || !msg.payload) return;
      let event: EventPayload;
      try {
        const raw = JSON.parse(msg.payload) as Record<string, unknown>;
        event = {
          id: Number(raw['id']),
          annotation_id: String(raw['annotation_id']),
          document_id: typeof raw['document_id'] === 'string' ? raw['document_id'] : null,
          kind: raw['kind'] as AnnotationEventKind,
        };
      } catch (err) {
        this.log.warn({ err, payload: msg.payload }, 'ignoring malformed notification');
        return;
      }
      for (const listener of this.listeners) listener(event);
    });
    client.on('error', (err) => {
      this.log.error({ err }, 'event listener connection lost');
      void this.scheduleReconnect();
    });
    client.on('end', () => {
      if (!this.stopped && this.client === client) void this.scheduleReconnect();
    });
    await client.connect();
    await client.query(`listen ${EVENT_CHANNEL}`);
    this.client = client;
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopped) return;
    const old = this.client;
    this.client = undefined;
    if (old) {
      old.removeAllListeners();
      old.on('error', () => undefined);
      await old.end().catch(() => undefined);
    }
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err: unknown) => {
        this.log.error({ err }, 'event listener reconnect failed');
        void this.scheduleReconnect();
      });
    }, this.reconnectDelayMs);
  }
}
