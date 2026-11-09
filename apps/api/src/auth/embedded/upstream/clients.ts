/**
 * Talking to an upstream provider (ADR 0028): the authorization redirect and
 * the exchange of the code for who the person is. Two kinds are supported,
 * OpenID Connect (Google and any other, proving identity by a signed ID token)
 * and GitHub's OAuth2 (proving it by asking its API). Nothing here decides
 * what an identity may do; it only reports who it is and whether its email
 * address is verified.
 */
import * as oidc from 'openid-client';
import type { UpstreamProvider } from '../../../config.js';

export interface UpstreamProfile {
  /** The provider's stable identifier for the person; never the email. */
  subject: string;
  email: string | undefined;
  /** Whether the provider vouches that the person owns `email`. */
  emailVerified: boolean;
  name: string | undefined;
}

export interface ProviderClient {
  authorizeUrl(request: {
    redirectUri: string;
    state: string;
    nonce: string;
    challenge: string;
  }): Promise<string>;
  exchange(request: {
    redirectUri: string;
    callback: URL;
    state: string;
    verifier: string;
    nonce: string;
  }): Promise<UpstreamProfile>;
}

const TIMEOUT_MS = 10_000;
const signal = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS);

async function json(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`the provider answered ${res.status}`);
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null) throw new Error('the provider sent no object');
  return body as Record<string, unknown>;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export function createClient(provider: UpstreamProvider): ProviderClient {
  return provider.kind === 'github' ? githubClient(provider) : oidcClient(provider);
}

function oidcClient(provider: UpstreamProvider): ProviderClient {
  const issuer = new URL(provider.issuer ?? '');
  const authenticate: oidc.ClientAuth = (server, client, body, headers) =>
    (server.token_endpoint_auth_methods_supported?.includes('client_secret_post')
      ? oidc.ClientSecretPost
      : oidc.ClientSecretBasic)(provider.clientSecret)(server, client, body, headers);
  let configuration: Promise<oidc.Configuration> | undefined;
  const discover = (): Promise<oidc.Configuration> => {
    configuration ??= oidc.discovery(
      issuer,
      provider.clientId,
      provider.clientSecret,
      authenticate,
      {
        timeout: TIMEOUT_MS / 1000,
        execute: [
          oidc.enableNonRepudiationChecks,
          ...(issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : []),
        ],
      },
    );
    configuration.catch(() => (configuration = undefined));
    return configuration;
  };
  return {
    async authorizeUrl(request) {
      return oidc.buildAuthorizationUrl(await discover(), {
        redirect_uri: request.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: request.state,
        nonce: request.nonce,
        code_challenge: request.challenge,
        code_challenge_method: 'S256',
      }).href;
    },
    async exchange(request) {
      const tokens = await oidc.authorizationCodeGrant(await discover(), request.callback, {
        expectedState: request.state,
        expectedNonce: request.nonce,
        pkceCodeVerifier: request.verifier,
      });
      const claims = tokens.claims();
      const subject = text(claims?.sub);
      if (!subject) throw new Error('the provider sent no subject');
      const verified: unknown = claims?.email_verified;
      return {
        subject,
        email: text(claims?.email),
        emailVerified: verified === true || verified === 'true',
        name: text(claims?.name),
      };
    },
  };
}

function githubClient(provider: UpstreamProvider): ProviderClient {
  const authorize = provider.endpoints?.authorize ?? 'https://github.com/login/oauth/authorize';
  const tokenUrl = provider.endpoints?.token ?? 'https://github.com/login/oauth/access_token';
  const api = provider.endpoints?.api ?? 'https://api.github.com';
  return {
    authorizeUrl(request) {
      const url = new URL(authorize);
      url.search = new URLSearchParams({
        client_id: provider.clientId,
        redirect_uri: request.redirectUri,
        scope: 'read:user user:email',
        state: request.state,
        code_challenge: request.challenge,
        code_challenge_method: 'S256',
      }).toString();
      return Promise.resolve(url.href);
    },
    async exchange(request) {
      const token = await json(
        await fetch(tokenUrl, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            client_id: provider.clientId,
            client_secret: provider.clientSecret,
            code: request.callback.searchParams.get('code'),
            redirect_uri: request.redirectUri,
            code_verifier: request.verifier,
          }),
          signal: signal(),
        }),
      );
      const accessToken = text(token['access_token']);
      if (!accessToken) throw new Error('GitHub sent no access token');
      const headers = {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'curanno',
      };
      const user = await json(await fetch(`${api}/user`, { headers, signal: signal() }));
      const id = user['id'];
      if (typeof id !== 'number' && typeof id !== 'string')
        throw new Error('GitHub sent no user id');
      // Only the primary address GitHub has verified is believed; the profile's own `email` is free text.
      const emailsRes = await fetch(`${api}/user/emails`, { headers, signal: signal() });
      const emails: unknown = emailsRes.ok ? await emailsRes.json() : [];
      const primary = (Array.isArray(emails) ? (emails as Record<string, unknown>[]) : []).find(
        (e) => e['primary'] === true && e['verified'] === true && text(e['email']),
      );
      return {
        subject: String(id),
        email: primary ? text(primary['email']) : undefined,
        emailVerified: primary !== undefined,
        name: text(user['name']) ?? text(user['login']),
      };
    },
  };
}
