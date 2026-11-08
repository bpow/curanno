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
    });
    expect(config.oidc).toEqual({
      issuer: 'https://curanno.example',
      clientId: EMBEDDED_CLIENT_ID,
      audience: 'https://curanno.example',
    });
  });

  it('refuses embedded mode without a long enough secret, and unknown modes', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'embedded' })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...base, AUTH_MODE: 'embedded', AUTH_SECRET: 'short' })).toThrow(
      /AUTH_SECRET/,
    );
    expect(() => loadConfig({ ...base, AUTH_MODE: 'magic' })).toThrow(/AUTH_MODE/);
  });
});
