/**
 * The API as the load runner drives it: built from `dist/` against
 * DATABASE_URL, trusting the key the runner generated (LOAD_JWK) for the
 * load issuer instead of a real identity provider. Started by load-run.ts;
 * prints its address as a JSON line once it listens.
 */
import { createLocalJWKSet, type JWK } from 'jose';
import { createTokenVerifier } from '../dist/auth/verifier.js';
import type { Config } from '../dist/config.js';
import { createDb } from '../dist/db/index.js';
import { buildServer } from '../dist/server.js';
import { LOAD_CLIENT_ID, LOAD_ISSUER } from './load-common.ts';

const databaseUrl = process.env['DATABASE_URL'];
const jwkJson = process.env['LOAD_JWK'];
if (!databaseUrl || !jwkJson) throw new Error('DATABASE_URL and LOAD_JWK are required');
const jwk = JSON.parse(jwkJson) as JWK;
const port = Number(process.env['PORT'] ?? 0);

const config: Config = {
  databaseUrl,
  oidc: {
    issuer: LOAD_ISSUER,
    clientId: LOAD_CLIENT_ID,
    audience: LOAD_CLIENT_ID,
    adminGroup: undefined,
  },
  port,
  publicUrl: `http://127.0.0.1:${port}`,
  logLevel: 'warn',
  staticRoot: undefined,
  frameAncestors: ["'self'"],
  pdfViewerOrigin: undefined,
  metricsEnabled: true,
};
const db = createDb(databaseUrl);
const app = await buildServer({
  config,
  db,
  verifyToken: createTokenVerifier({ ...config.oidc, jwks: createLocalJWKSet({ keys: [jwk] }) }),
  logger: { level: 'warn' },
});
const address = await app.listen({ port, host: '127.0.0.1' });
console.log(JSON.stringify({ listening: address }));

const shutdown = (): void => {
  void app
    .close()
    .then(() => db.destroy())
    .then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
