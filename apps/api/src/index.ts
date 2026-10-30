import { createTokenVerifier } from './auth/verifier.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { buildServer } from './server.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = await buildServer({
  config,
  db,
  verifyToken: createTokenVerifier(config.oidc),
  // JSON lines from pino, one per request with its `reqId`; tokens never reach the log.
  logger: {
    level: config.logLevel,
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
  },
});

const shutdown = (signal: string): void => {
  app.log.info({ signal }, 'shutting down');
  void app
    .close()
    .then(() => db.destroy())
    .then(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
