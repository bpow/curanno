/**
 * Server configuration, read entirely from environment variables so that
 * the same image runs everywhere (plan, section 9). `.env.example` lists them.
 */
export interface Config {
  databaseUrl: string;
  oidc: {
    /** Issuer IRI; discovery happens at `<issuer>/.well-known/openid-configuration`. */
    issuer: string;
    /** The client the sidebar authenticates as; tokens with this `azp` are accepted. */
    clientId: string;
    /** Accepted `aud` value. Defaults to the client id. */
    audience: string;
    /** Members of this group (from the `groups` claim) are platform administrators. */
    adminGroup: string | undefined;
  };
  port: number;
  /** Origin and base path under which annotation IRIs are minted, without a trailing slash. */
  publicUrl: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive integer');
  const clientId = required(env, 'OIDC_CLIENT_ID');
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    oidc: {
      issuer: required(env, 'OIDC_ISSUER').replace(/\/$/, ''),
      clientId,
      audience: env['OIDC_AUDIENCE'] || clientId,
      adminGroup: env['OIDC_ADMIN_GROUP'] || undefined,
    },
    port,
    publicUrl: (env['PUBLIC_URL'] || `http://localhost:${port}`).replace(/\/$/, ''),
    logLevel: env['LOG_LEVEL'] || 'info',
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
