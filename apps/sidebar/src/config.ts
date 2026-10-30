/**
 * Runtime configuration. The build-time defaults (`VITE_*` variables, then
 * the compose stack's values) are overridden by `config.json` next to the
 * app, which the API serves from its own environment in a deployment so one
 * image runs everywhere (plan, section 9). Nothing here may come from the
 * host page (ADR 0007): page-supplied configuration must never choose the
 * issuer, the client or the API.
 */

/** The shape of `config.json`; every field is optional. */
export interface RuntimeConfig {
  oidcIssuer?: string;
  oidcClientId?: string;
  /** API origin, when it is not served under the sidebar's origin. */
  apiUrl?: string;
}

export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? '',
  oidc: {
    issuer: import.meta.env.VITE_OIDC_ISSUER ?? 'http://localhost:8080/realms/annotations-dev',
    clientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? 'annotations-sidebar',
  },
};

/** The URL of `config.json` relative to the app's base. */
export function configUrl(): string {
  return new URL('config.json', new URL(import.meta.env.BASE_URL, window.location.origin)).href;
}

/**
 * Loads `config.json` and applies it; a missing or malformed file leaves the
 * defaults in place. Called once before anything reads `config`.
 */
export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<void> {
  let runtime: RuntimeConfig | undefined;
  try {
    const response = await fetchImpl(configUrl(), { cache: 'no-cache' });
    if (!response.ok) return;
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) return;
    runtime = (await response.json()) as RuntimeConfig;
  } catch {
    return;
  }
  applyConfig(runtime);
}

export function applyConfig(runtime: RuntimeConfig | undefined): void {
  if (!runtime || typeof runtime !== 'object') return;
  if (typeof runtime.oidcIssuer === 'string' && runtime.oidcIssuer) {
    config.oidc.issuer = runtime.oidcIssuer.replace(/\/$/, '');
  }
  if (typeof runtime.oidcClientId === 'string' && runtime.oidcClientId) {
    config.oidc.clientId = runtime.oidcClientId;
  }
  if (typeof runtime.apiUrl === 'string') config.apiUrl = runtime.apiUrl.replace(/\/$/, '');
}
