// Binding A: fastify-openapi-glue registers one route per operation and maps
// operationId to a handler on the service object.
import Fastify from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import { fileURLToPath } from 'node:url';
import { handlers, runScenarios } from './scenarios.ts';

const app = Fastify({ logger: false });
await app.register(openapiGlue, {
  specification: fileURLToPath(new URL('./openapi.yaml', import.meta.url)),
  serviceHandlers: {
    getItem(req: { params: { id: string } }, reply: { code: (n: number) => unknown }) {
      const r = handlers.getItem(req.params.id);
      reply.code(r.status);
      return r.body;
    },
    createItem(
      req: { body: { name: string; tags?: string[] } },
      reply: { code: (n: number) => unknown },
    ) {
      const r = handlers.createItem(req.body);
      reply.code(r.status);
      return r.body;
    },
  },
});
await runScenarios('fastify-openapi-glue', app);
