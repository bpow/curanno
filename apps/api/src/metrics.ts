/**
 * Prometheus metrics at `/metrics`: the process defaults, one histogram of
 * request durations by route and status, and a gauge of open event streams.
 * The registry is per server instance so tests can build several servers.
 */
import type { FastifyInstance } from 'fastify';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface Metrics {
  registry: Registry;
  eventStreams: Gauge;
  eventsDelivered: Counter;
}

export function installMetrics(app: FastifyInstance, options: { enabled: boolean }): Metrics {
  const registry = new Registry();
  const eventStreams = new Gauge({
    name: 'annotations_event_streams_open',
    help: 'Server-sent event streams currently open',
    registers: [registry],
  });
  const eventsDelivered = new Counter({
    name: 'annotations_events_delivered_total',
    help: 'Annotation events written to event streams, by kind',
    labelNames: ['kind'],
    registers: [registry],
  });
  if (!options.enabled) return { registry, eventStreams, eventsDelivered };

  collectDefaultMetrics({ register: registry });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route and status',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  app.addHook('onResponse', (request, reply, done) => {
    // The route pattern, never the URL: paths carry identifiers.
    const route = request.routeOptions.url ?? 'unmatched';
    duration.observe(
      { method: request.method, route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
    done();
  });
  app.get('/metrics', async (_request, reply) => {
    reply.type(registry.contentType);
    return registry.metrics();
  });
  return { registry, eventStreams, eventsDelivered };
}
