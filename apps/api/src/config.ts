/**
 * Server configuration, read entirely from environment variables so that
 * the same image runs everywhere (plan, section 9). `.env.example` lists them.
 */
/** The client id of the embedded issuer's one client: the sidebar and the site (ADR 0028). */
export const EMBEDDED_CLIENT_ID = 'curanno';

/** An upstream sign-in provider the operator configured (ADR 0028). */
export interface UpstreamProvider {
  /** `google`, `github` or `oidc`; part of the callback address. */
  id: string;
  label: string;
  kind: 'oidc' | 'github';
  clientId: string;
  clientSecret: string;
  /** `oidc`: the issuer, whose discovery document names the rest. */
  issuer?: string;
  /** Overrides of the provider's endpoints; for tests and GitHub Enterprise. */
  endpoints?: { authorize?: string; token?: string; api?: string };
}

export type SignupPolicy = 'closed' | 'approval' | 'open';

export interface Config {
  databaseUrl: string;
  /**
   * Who issues the tokens (ADR 0028): `external` is an OpenID Connect provider
   * of the operator's, `embedded` is the issuer in this process.
   */
  auth: {
    mode: 'external' | 'embedded';
    /** Embedded mode: encrypts the signing keys in the database and keys the cookies; at least 32 characters. */
    secret: string | undefined;
    /** Embedded mode: origins besides `publicUrl` where the clients run, for the client's redirect URIs. */
    extraOrigins: string[];
    /** Embedded mode: browser extensions whose `https://<id>.chromiumapp.org/` may receive codes (ADR 0029). */
    extensionIds: string[];
    /** Embedded mode: where account mail (invitations, resets) is sent through, e.g. `smtps://user:pass@host`; unset sends none. */
    smtpUrl: string | undefined;
    /** Embedded mode: the From address of account mail. */
    mailFrom: string | undefined;
    /** Embedded mode: who may create an account by themselves. Invitations work in every policy. */
    signup: SignupPolicy;
    /** Embedded mode, `approval`: applicants whose verified address is in one of these domains are approved at once. */
    autoApproveDomains: string[];
    /** Embedded mode: the providers people can sign in with besides a password. */
    providers: UpstreamProvider[];
    /** Embedded mode: providers whose verified email may join an existing account without asking for its password. Off by default. */
    autolink: string[];
    /** Embedded mode: sign-up is refused while this many applications wait. */
    maxPending: number;
    /** Embedded mode: while no administrator exists, this address is invited to become one. */
    bootstrapAdminEmail: string | undefined;
  };
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
  const mode = authMode(env['AUTH_MODE']);
  const publicUrl = (env['PUBLIC_URL'] || `http://localhost:${port}`).replace(/\/$/, '');
  const embedded = mode === 'embedded';
  // The embedded issuer has one client, fixed: a leftover OIDC_CLIENT_ID (from the compose
  // provisioner's file, say) must not rename it.
  const clientId = embedded ? EMBEDDED_CLIENT_ID : required(env, 'OIDC_CLIENT_ID');
  const secret = env['AUTH_SECRET'] || undefined;
  if (embedded && (!secret || secret.length < 32)) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters when AUTH_MODE=embedded');
  }
  const smtpUrl = env['SMTP_URL'] || undefined;
  const mailFrom = env['MAIL_FROM'] || undefined;
  if (smtpUrl && !mailFrom) throw new Error('MAIL_FROM must be set when SMTP_URL is');
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    auth: {
      mode,
      secret,
      extraOrigins: (env['AUTH_EXTRA_ORIGINS'] || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((o) => origin(o, 'AUTH_EXTRA_ORIGINS')),
      extensionIds: extensionIds(env['AUTH_EXTENSION_IDS']),
      signup: signupPolicy(env['AUTH_SIGNUP']),
      autoApproveDomains: (env['AUTH_AUTO_APPROVE_DOMAINS'] || '')
        .split(/[\s,]+/)
        .map((d) => d.toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
      providers: upstreamProviders(env),
      autolink: (env['AUTH_AUTOLINK'] || '').split(/[\s,]+/).filter(Boolean),
      maxPending: positive(env['AUTH_MAX_PENDING'], 200, 'AUTH_MAX_PENDING'),
      smtpUrl,
      mailFrom,
      bootstrapAdminEmail: env['BOOTSTRAP_ADMIN_EMAIL']?.trim().toLowerCase() || undefined,
    },
    oidc: {
      // The embedded issuer is this server, on the origin the browser sees.
      issuer: (embedded ? publicUrl : required(env, 'OIDC_ISSUER')).replace(/\/$/, ''),
      clientId,
      audience: env['OIDC_AUDIENCE'] || (embedded ? publicUrl : clientId),
    },
    port,
    publicUrl,
    logLevel: env['LOG_LEVEL'] || 'info',
    staticRoot: env['STATIC_ROOT'] || undefined,
    frameAncestors: (env['FRAME_ANCESTORS'] || "'self'").split(/\s+/).filter(Boolean),
    pdfViewerOrigin: env['PDF_VIEWER_ORIGIN']
      ? origin(env['PDF_VIEWER_ORIGIN'], 'PDF_VIEWER_ORIGIN')
      : undefined,
    metricsEnabled: env['METRICS_ENABLED'] !== 'false',
  };
}

function upstreamProviders(env: NodeJS.ProcessEnv): UpstreamProvider[] {
  const providers: UpstreamProvider[] = [];
  const pair = (prefix: string): { clientId: string; clientSecret: string } | undefined => {
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (!clientId && !clientSecret) return undefined;
    if (!clientId || !clientSecret) {
      throw new Error(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be set together`);
    }
    return { clientId, clientSecret };
  };
  const google = pair('UPSTREAM_GOOGLE');
  if (google) {
    providers.push({
      id: 'google',
      label: 'Google',
      kind: 'oidc',
      issuer: 'https://accounts.google.com',
      ...google,
    });
  }
  const github = pair('UPSTREAM_GITHUB');
  if (github) providers.push({ id: 'github', label: 'GitHub', kind: 'github', ...github });
  const generic = pair('UPSTREAM_OIDC');
  if (generic) {
    providers.push({
      id: 'oidc',
      label: env['UPSTREAM_OIDC_NAME'] || 'Single sign-on',
      kind: 'oidc',
      issuer: required(env, 'UPSTREAM_OIDC_ISSUER').replace(/\/$/, ''),
      ...generic,
    });
  }
  return providers;
}

function signupPolicy(value: string | undefined): SignupPolicy {
  if (!value) return 'approval';
  if (value === 'closed' || value === 'approval' || value === 'open') return value;
  throw new Error(`AUTH_SIGNUP must be "closed", "approval" or "open", not "${value}"`);
}

function positive(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function authMode(value: string | undefined): 'external' | 'embedded' {
  if (!value || value === 'external') return 'external';
  if (value === 'embedded') return 'embedded';
  throw new Error(`AUTH_MODE must be "external" or "embedded", not "${value}"`);
}

function extensionIds(value: string | undefined): string[] {
  const ids = (value || '').split(/[\s,]+/).filter(Boolean);
  for (const id of ids) {
    if (!/^[a-p]{32}$/.test(id)) {
      throw new Error(`AUTH_EXTENSION_IDS: not an extension id (32 letters a-p): ${id}`);
    }
  }
  return ids;
}

function origin(value: string, name: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
