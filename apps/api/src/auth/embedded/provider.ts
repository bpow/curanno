/**
 * The embedded OpenID Connect issuer (ADR 0028): oidc-provider, configured as
 * the one first-party public client that the sidebar and the site are, mounted
 * in this process under `/oidc` with discovery at the origin's root. Access
 * tokens are JWTs for this API, carrying the user's name and email, so the
 * verifier needs neither a network call nor userinfo.
 */
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import type { Kysely } from 'kysely';
import Provider, { type Configuration } from 'oidc-provider';
import type { Config } from '../../config.js';
import type { Database } from '../../db/schema.js';
import { createTokenVerifier, type TokenVerifier } from '../verifier.js';
import { loadProfile } from './accounts.js';
import { registerAccountRoutes } from './account-routes.js';
import { createAdapterClass, purgeExpired } from './adapter.js';
import { ensureBootstrapAdmin } from './invites.js';
import { registerInteractionRoutes } from './interaction.js';
import { loadSigningKeys, retireOldKeys } from './keys.js';
import { createMailer, type Mailer } from './mail.js';
import { errorPage, logoutPage, signedOutPage, SUBMIT_SCRIPT_HASH } from './pages.js';
import { cookieKeys } from './secrets.js';
import { purgeEvents, Throttle } from './throttle.js';
import { purgeTokens } from './tokens.js';

const HOUR = 3600;
const DAY = 24 * HOUR;
const SCOPES = ['openid', 'profile', 'email', 'offline_access'];
const CLIENT_PATHS = [
  '/sidebar/',
  '/sidebar/popup-callback.html',
  '/sidebar/silent-renew.html',
  '/auth/callback',
];
const KEY_RELOAD_MIN_MS = 10_000;
const HOUSEKEEPING_MS = 10 * 60_000;

export interface EmbeddedIssuer {
  provider: Provider;
  /** Verifies the access tokens this issuer signed, against its own keys. */
  verifyToken: TokenVerifier;
  /** Mounts the provider and its sign-in routes on the server. */
  register(app: FastifyInstance): Promise<void>;
  /** Stops the housekeeping timer. */
  close(): void;
}

export async function createEmbeddedIssuer(options: {
  config: Config;
  db: Kysely<Database>;
  /** Replaces the SMTP mailer the configuration describes; for tests. */
  mailer?: Mailer;
}): Promise<EmbeddedIssuer> {
  const { config, db } = options;
  const secret = config.auth.secret;
  if (config.auth.mode !== 'embedded' || !secret) {
    throw new Error('the embedded issuer needs AUTH_MODE=embedded and AUTH_SECRET');
  }
  const issuer = config.oidc.issuer;
  if (new URL(issuer).origin !== issuer) {
    throw new Error(`the embedded issuer must be an origin, without a path: ${issuer}`);
  }
  const authSecret: string = secret;
  const https = issuer.startsWith('https://');
  const origins = [...new Set([issuer, ...config.auth.extraOrigins])];

  const throttle = new Throttle(db, authSecret);
  const mailer: Mailer | undefined =
    options.mailer ??
    (config.auth.smtpUrl
      ? createMailer(config.auth.smtpUrl, config.auth.mailFrom ?? '')
      : undefined);

  let keys = await loadSigningKeys(db, secret);
  const provider = new Provider(issuer, providerConfiguration());
  // Behind a TLS-terminating ingress, cookies must still be marked secure.
  provider.proxy = https;

  // Verification follows the database, so a key another replica adds is known without a restart.
  let reloadedAt = Date.now();
  const getKey: JWTVerifyGetKey = async (header, token) => {
    try {
      return await createLocalJWKSet(keys.public)(header, token);
    } catch (err) {
      if (Date.now() - reloadedAt < KEY_RELOAD_MIN_MS) throw err;
      reloadedAt = Date.now();
      keys = { ...keys, public: (await loadSigningKeys(db, secret)).public };
      return createLocalJWKSet(keys.public)(header, token);
    }
  };
  const verifyToken = createTokenVerifier({
    issuer,
    clientId: config.oidc.clientId,
    audience: config.oidc.audience,
    jwks: getKey,
  });

  let timer: NodeJS.Timeout | undefined;

  return {
    provider,
    verifyToken,
    async register(app) {
      const callback = provider.callback();
      await app.register((scope, _options, done) => {
        // The provider reads the request body itself; the server must leave it unread.
        scope.removeAllContentTypeParsers();
        scope.addContentTypeParser('*', (_request, _payload, done) => done(null));
        scope.addHook('onRequest', (_request, reply, done) => {
          // A hijacked reply skips the server's own headers, so the provider's pages get them here.
          reply.raw.setHeader('x-content-type-options', 'nosniff');
          reply.raw.setHeader('referrer-policy', 'no-referrer');
          reply.raw.setHeader(
            'content-security-policy',
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          );
          if (https)
            reply.raw.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
          done();
        });
        const handler = (
          request: { raw: Parameters<typeof callback>[0] },
          reply: { hijack(): void; raw: Parameters<typeof callback>[1] },
        ): void => {
          reply.hijack();
          void callback(request.raw, reply.raw);
        };
        scope.all('/oidc/*', handler);
        scope.all('/.well-known/openid-configuration', handler);
        done();
      });
      registerInteractionRoutes(app, { provider, db, throttle, origin: issuer });
      registerAccountRoutes(app, { db, throttle, mailer, origin: issuer });
      provider.on('server_error', (_ctx, err) => app.log.error({ err }, 'issuer error'));

      const housekeeping = (): void => {
        purgeExpired(db).catch((err: unknown) =>
          app.log.warn({ err }, 'purging the issuer store failed'),
        );
        retireOldKeys(db, 2 * DAY * 1000).catch((err: unknown) =>
          app.log.warn({ err }, 'retiring keys failed'),
        );
        Promise.all([purgeEvents(db), purgeTokens(db)]).catch((err: unknown) =>
          app.log.warn({ err }, 'purging account records failed'),
        );
      };
      housekeeping();
      if (config.auth.bootstrapAdminEmail) {
        await ensureBootstrapAdmin(db, {
          email: config.auth.bootstrapAdminEmail,
          publicUrl: issuer,
          mailer,
          log: app.log,
        }).catch((err: unknown) =>
          app.log.warn({ err }, 'inviting the first administrator failed'),
        );
      }
      timer = setInterval(housekeeping, HOUSEKEEPING_MS);
      timer.unref();
    },
    close() {
      if (timer) clearInterval(timer);
    },
  };

  function providerConfiguration(): Configuration {
    return {
      adapter: createAdapterClass(db),
      clients: [
        {
          client_id: config.oidc.clientId,
          token_endpoint_auth_method: 'none',
          application_type: 'web',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          redirect_uris: origins.flatMap((o) => CLIENT_PATHS.map((p) => o + p)),
          post_logout_redirect_uris: origins.flatMap((o) => [`${o}/sidebar/`, `${o}/`]),
        },
      ],
      clientDefaults: { id_token_signed_response_alg: 'ES256' },
      jwks: { keys: keys.private },
      cookies: {
        keys: cookieKeys(authSecret),
        long: { sameSite: 'lax' },
        short: { sameSite: 'lax' },
      },
      routes: {
        authorization: '/oidc/auth',
        token: '/oidc/token',
        jwks: '/oidc/jwks',
        end_session: '/oidc/session/end',
      },
      scopes: SCOPES,
      claims: { openid: ['sub'], profile: ['name'], email: ['email'] },
      // The access token carries the profile, so the ID token is complete and there is no userinfo.
      conformIdTokenClaims: false,
      pkce: { required: () => true },
      clientBasedCORS: (_ctx, origin) => origins.includes(origin),
      ttl: {
        AccessToken: HOUR,
        AuthorizationCode: 60,
        IdToken: HOUR,
        RefreshToken: 30 * DAY,
        Interaction: 10 * 60,
        Session: 14 * DAY,
        Grant: 30 * DAY,
      },
      features: {
        devInteractions: { enabled: false },
        userinfo: { enabled: false },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => config.oidc.audience,
          useGrantedResource: () => true,
          getResourceServerInfo: () => ({
            scope: SCOPES.join(' '),
            audience: config.oidc.audience,
            accessTokenTTL: HOUR,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'ES256' } },
          }),
        },
        rpInitiatedLogout: {
          enabled: true,
          logoutSource(ctx, form) {
            ctx.set(
              'content-security-policy',
              `default-src 'none'; style-src 'unsafe-inline'; script-src ${SUBMIT_SCRIPT_HASH}; form-action 'self' ${origins.join(' ')}`,
            );
            ctx.type = 'html';
            ctx.body = logoutPage(form);
          },
          postLogoutSuccessSource(ctx) {
            ctx.type = 'html';
            ctx.body = signedOutPage();
          },
        },
      },
      interactions: { url: (_ctx, interaction) => `/oidc/interaction/${interaction.uid}` },
      renderError(ctx, out) {
        ctx.type = 'html';
        ctx.body = errorPage(String(out['error'] ?? ''), out['error_description']);
      },
      async findAccount(_ctx, id) {
        const profile = await loadProfile(db, id);
        if (!profile) return undefined;
        return {
          accountId: id,
          claims: () => ({ sub: id, name: profile.name, email: profile.email }),
        };
      },
      async extraTokenClaims(_ctx, token) {
        const accountId = (token as { accountId?: string }).accountId;
        const profile = accountId ? await loadProfile(db, accountId) : undefined;
        return {
          ...(profile?.name ? { name: profile.name } : {}),
          ...(profile?.email ? { email: profile.email } : {}),
        };
      },
      // A first-party client: grant what it asked for without a consent screen.
      async loadExistingGrant(ctx) {
        const grantId =
          ctx.oidc.result?.consent?.grantId ??
          ctx.oidc.session?.grantIdFor(ctx.oidc.client?.clientId as string);
        if (grantId) return ctx.oidc.provider.Grant.find(grantId);
        const grant = new ctx.oidc.provider.Grant({
          clientId: ctx.oidc.client?.clientId as string,
          accountId: ctx.oidc.session?.accountId as string,
        });
        const requested = ctx.oidc.params?.['scope'];
        grant.addOIDCScope(typeof requested === 'string' ? requested : 'openid');
        grant.addResourceScope(config.oidc.audience, SCOPES.join(' '));
        await grant.save();
        return grant;
      },
      // offline_access is otherwise ignored without prompt=consent (OIDC Core, 11).
      issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    };
  }
}
