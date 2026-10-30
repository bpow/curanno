/**
 * The Fastify server, bound to apps/api/openapi.yaml through
 * fastify-openapi-glue (ADR 0011): one handler per operationId, Ajv
 * validating requests strictly and responses against the document, the
 * `application/ld+json` media type the W3C protocol uses, problem details
 * for every error, and the OIDC bearer-token security handler (ADR 0005).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { parse } from 'yaml';
import { TEXT_MODEL_VERSION } from '@scale/model';
import { createCoercingAjv, createStrictAjv } from './ajv.js';
import { AnnotationStore } from './annotations/store.js';
import { installAuth, securityHandlers } from './auth/plugin.js';
import type { TokenVerifier } from './auth/verifier.js';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import { EventBridge } from './events/bridge.js';
import { installMetrics } from './metrics.js';
import { Problem, installProblemHandlers, sendProblem, serviceUnavailable } from './problems.js';
import { ProfileService } from './profiles/service.js';
import { createHandlers } from './routes/index.js';
import type { AppContext } from './routes/context.js';
import { installStatic } from './static.js';

export const OPENAPI_PATH = fileURLToPath(new URL('../openapi.yaml', import.meta.url));

export interface ServerOptions {
  config: Config;
  db: Kysely<Database>;
  verifyToken: TokenVerifier;
  logger?: FastifyServerOptions['logger'];
  /** Interval between keepalive comments on event streams; 30 s per the API document. */
  keepaliveMs?: number;
  /** How long a validated token is reused before the user row is refreshed. */
  authCacheMs?: number;
}

interface OpenApiPaths {
  paths: Record<string, Record<string, unknown>>;
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch']);

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({
    logger: options.logger ?? false,
    // One id per request, taken from the proxy's X-Request-Id when there is
    // one, in every log line (`reqId`) and echoed to the client.
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    genReqId: () => randomUUID(),
    // Behind the ingress; the client address in logs is the one it forwarded.
    trustProxy: true,
  });
  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    done();
  });
  installSecurityHeaders(app, config);
  const metrics = installMetrics(app, { enabled: config.metricsEnabled });

  const strict = createStrictAjv();
  const coercing = createCoercingAjv();
  app.setValidatorCompiler(({ schema, httpPart }) => {
    const ajv = httpPart === 'body' ? strict : coercing;
    return ajv.compile(httpPart === 'headers' ? lowerCaseHeaderSchema(schema) : schema);
  });
  // Serialize with JSON.stringify so that JSON-LD extension properties and
  // oneOf responses survive; the response is validated separately below.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));
  app.addContentTypeParser(
    'application/ld+json',
    { parseAs: 'string' },
    app.getDefaultJsonParser('error', 'error'),
  );

  installProblemHandlers(app);
  installAuth(app, {
    db,
    verifyToken: options.verifyToken,
    adminGroup: config.oidc.adminGroup,
    ...(options.authCacheMs !== undefined ? { cacheMs: options.authCacheMs } : {}),
  });
  installResponseValidation(app, strict);

  const profiles = new ProfileService(db, strict);
  const bridge = new EventBridge(config.databaseUrl, app.log);
  const ctx: AppContext = {
    db,
    config,
    store: new AnnotationStore(db, config.publicUrl),
    profiles,
    bridge,
    metrics,
    keepaliveMs: options.keepaliveMs ?? 30_000,
  };

  await app.register(openapiGlue, {
    specification: OPENAPI_PATH,
    serviceHandlers: createHandlers(ctx),
    securityHandlers,
  });
  installOptions(app);
  if (config.staticRoot) await installStatic(app, { root: config.staticRoot, config });

  app.get('/healthz', () => ({ status: 'ok', textModelVersion: TEXT_MODEL_VERSION }));
  app.get('/readyz', async (request, reply) => {
    try {
      await sql`select 1`.execute(db);
    } catch (err) {
      request.log.warn({ err }, 'readiness check failed');
      return sendProblem(reply, serviceUnavailable('database unavailable'));
    }
    return { status: 'ok' };
  });

  app.addHook('onReady', async () => {
    await profiles.seedBuiltins();
    await bridge.start();
  });
  app.addHook('onClose', async () => {
    await bridge.stop();
  });

  return app;
}

/**
 * Headers every response carries. The JSON origin needs no scripts or
 * framing; bearer-authenticated answers are not for shared caches; the
 * static clients set their own Content-Security-Policy in `static.ts`.
 */
function installSecurityHeaders(app: FastifyInstance, config: Config): void {
  const https = config.publicUrl.startsWith('https://');
  app.addHook('onSend', (request, reply, payload, done) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (https) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    }
    if (request.headers.authorization && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    done(null, payload);
  });
}

/**
 * Node lowercases incoming header names; Fastify would lowercase the header
 * schema too, but not when a custom validator compiler is installed.
 */
function lowerCaseHeaderSchema(schema: object): object {
  const { properties, required, ...rest } = schema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (!properties) return schema;
  return {
    ...rest,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, value]) => [name.toLowerCase(), value]),
    ),
    ...(required ? { required: required.map((name) => name.toLowerCase()) } : {}),
  };
}

/** Validate every JSON response against the document's schema for its status and media type. */
function installResponseValidation(
  app: FastifyInstance,
  ajv: ReturnType<typeof createStrictAjv>,
): void {
  const compiled = new WeakMap<object, ReturnType<typeof ajv.compile>>();
  app.addHook('preSerialization', async (request, reply, payload) => {
    const responses = request.routeOptions.schema?.response as
      Record<string, { content?: Record<string, { schema?: object }> } & object> | undefined;
    if (!responses) return payload;
    const status = String(reply.statusCode);
    const entry = responses[status] ?? responses[`${status[0]}xx`];
    if (!entry) return payload;
    let schema: object | undefined;
    if (entry.content) {
      const header = reply.getHeader('content-type');
      const mediaType = (typeof header === 'string' ? header : 'application/json')
        .split(';', 1)[0]
        ?.trim();
      schema = mediaType ? entry.content[mediaType]?.schema : undefined;
      if (!schema) {
        request.log.error({ status, mediaType }, 'response media type is not in the API document');
        throw new Problem(500, 'Internal Server Error');
      }
    } else {
      schema = entry;
    }
    let validate = compiled.get(schema);
    if (!validate) {
      validate = ajv.compile(schema);
      compiled.set(schema, validate);
    }
    if (!validate(payload)) {
      request.log.error(
        { status, errors: validate.errors, url: request.url },
        'response violates the API document',
      );
      throw new Problem(500, 'Internal Server Error');
    }
    return payload;
  });
}

/** `OPTIONS` for every documented path, answering with `Allow` as the document promises. */
function installOptions(app: FastifyInstance): void {
  const document = parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiPaths;
  for (const [path, item] of Object.entries(document.paths)) {
    const methods = Object.keys(item)
      .filter((m) => METHODS.has(m))
      .map((m) => m.toUpperCase());
    if (methods.includes('GET')) methods.push('HEAD');
    const allow = [...methods, 'OPTIONS'].sort().join(', ');
    app.route({
      method: 'OPTIONS',
      url: path.replace(/\{(\w+)\}/g, ':$1'),
      handler: (_request, reply) => reply.header('allow', allow).code(204).send(),
    });
  }
}
