import Fastify, { type FastifyInstance } from 'fastify';
import { TEXT_MODEL_VERSION } from '@scale/model';

export interface ServerOptions {
  logger?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/healthz', () => ({ status: 'ok', textModelVersion: TEXT_MODEL_VERSION }));

  return app;
}
