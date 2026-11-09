import { describe, expect, it } from 'vitest';
import { EMBEDDED_CLIENT_ID, loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://db/x' };
const secret = 's'.repeat(32);

describe('loadConfig', () => {
  it('trusts an external provider by default and needs its issuer and client', () => {
    expect(() => loadConfig(base)).toThrow(/OIDC_CLIENT_ID is not set/);
    expect(() => loadConfig({ ...base, OIDC_CLIENT_ID: 'sidebar' })).toThrow(
      /OIDC_ISSUER is not set/,
    );
    const config = loadConfig({
      ...base,
      OIDC_ISSUER: 'https://idp.example/',
      OIDC_CLIENT_ID: 'sidebar',
    });
    expect(config.auth.mode).toBe('external');
    expect(config.oidc).toEqual({
      issuer: 'https://idp.example',
      clientId: 'sidebar',
      audience: 'sidebar',
    });
  });

  it('is its own issuer in embedded mode, on the public URL', () => {
    const config = loadConfig({
      ...base,
      AUTH_MODE: 'embedded',
      AUTH_SECRET: secret,
      PUBLIC_URL: 'https://curanno.example/',
      AUTH_EXTRA_ORIGINS: 'http://localhost:5173 http://localhost:3001/some/path',
      // Left over from an external provider's setup; the embedded client keeps its name.
      OIDC_CLIENT_ID: '398448124395257859',
      OIDC_ISSUER: 'http://localhost:8080',
    });
    expect(config.auth).toEqual({
      mode: 'embedded',
      secret,
      extraOrigins: ['http://localhost:5173', 'http://localhost:3001'],
      signup: 'approval',
      autoApproveDomains: [],
      maxPending: 200,
      providers: [],
      autolink: [],
    });
    expect(config.oidc).toEqual({
      issuer: 'https://curanno.example',
      clientId: EMBEDDED_CLIENT_ID,
      audience: 'https://curanno.example',
    });
  });

  it('reads the sign-up policy, the approved domains and the queue cap', () => {
    const config = loadConfig({
      ...base,
      AUTH_MODE: 'embedded',
      AUTH_SECRET: secret,
      AUTH_SIGNUP: 'open',
      AUTH_AUTO_APPROVE_DOMAINS: '@Example.org, uni.example',
      AUTH_MAX_PENDING: '5',
    });
    expect(config.auth).toMatchObject({
      signup: 'open',
      autoApproveDomains: ['example.org', 'uni.example'],
      maxPending: 5,
    });
    expect(() =>
      loadConfig({ ...base, AUTH_MODE: 'embedded', AUTH_SECRET: secret, AUTH_SIGNUP: 'maybe' }),
    ).toThrow(/AUTH_SIGNUP/);
    expect(() =>
      loadConfig({ ...base, AUTH_MODE: 'embedded', AUTH_SECRET: secret, AUTH_MAX_PENDING: '-1' }),
    ).toThrow(/AUTH_MAX_PENDING/);
  });

  it('reads the upstream providers, and wants each one whole', () => {
    const env = {
      ...base,
      AUTH_MODE: 'embedded',
      AUTH_SECRET: secret,
      UPSTREAM_GOOGLE_CLIENT_ID: 'g',
      UPSTREAM_GOOGLE_CLIENT_SECRET: 'gs',
      UPSTREAM_GITHUB_CLIENT_ID: 'h',
      UPSTREAM_GITHUB_CLIENT_SECRET: 'hs',
      UPSTREAM_OIDC_ISSUER: 'https://sso.example/realms/x/',
      UPSTREAM_OIDC_CLIENT_ID: 'o',
      UPSTREAM_OIDC_CLIENT_SECRET: 'os',
      UPSTREAM_OIDC_NAME: 'Campus',
      AUTH_AUTOLINK: 'google, oidc',
    };
    const { providers, autolink } = loadConfig(env).auth;
    expect(providers.map((p) => [p.id, p.label, p.kind, p.issuer])).toEqual([
      ['google', 'Google', 'oidc', 'https://accounts.google.com'],
      ['github', 'GitHub', 'github', undefined],
      ['oidc', 'Campus', 'oidc', 'https://sso.example/realms/x'],
    ]);
    expect(autolink).toEqual(['google', 'oidc']);
    expect(() => loadConfig({ ...env, UPSTREAM_GITHUB_CLIENT_SECRET: '' })).toThrow(/together/);
    expect(() => loadConfig({ ...env, UPSTREAM_OIDC_ISSUER: '' })).toThrow(/UPSTREAM_OIDC_ISSUER/);
  });

  it('refuses embedded mode without a long enough secret, and unknown modes', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'embedded' })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...base, AUTH_MODE: 'embedded', AUTH_SECRET: 'short' })).toThrow(
      /AUTH_SECRET/,
    );
    expect(() => loadConfig({ ...base, AUTH_MODE: 'magic' })).toThrow(/AUTH_MODE/);
  });
});
