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
  };
  port: number;
  /** Origin and base path under which annotation IRIs are minted, without a trailing slash. */
  publicUrl: string;
  logLevel: string;
  /** Directory holding the built clients to serve (`sidebar/`, `pdf/`, `guest.js`); unset serves none. */
  staticRoot: string | undefined;
  /** Origins allowed to embed the sidebar (`frame-ancestors`), as CSP source expressions. */
  frameAncestors: string[];
  /** The PDF viewer's origin, served for that host only and trusted by the sidebar (ADR 0021). */
  pdfViewerOrigin: string | undefined;
  /** Whether `/metrics` is served. */
  metricsEnabled: boolean;
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
    },
    port,
    publicUrl: (env['PUBLIC_URL'] || `http://localhost:${port}`).replace(/\/$/, ''),
    logLevel: env['LOG_LEVEL'] || 'info',
    staticRoot: env['STATIC_ROOT'] || undefined,
    frameAncestors: (env['FRAME_ANCESTORS'] || "'self'").split(/\s+/).filter(Boolean),
    pdfViewerOrigin: env['PDF_VIEWER_ORIGIN'] ? origin(env['PDF_VIEWER_ORIGIN']) : undefined,
    metricsEnabled: env['METRICS_ENABLED'] !== 'false',
  };
}

function origin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`PDF_VIEWER_ORIGIN is not a URL: ${value}`);
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
