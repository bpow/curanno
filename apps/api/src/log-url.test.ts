import { describe, expect, it } from 'vitest';
import { logUrl } from './log-url.js';

describe('logUrl', () => {
  it('hides the token of an account link and leaves everything else', () => {
    expect(logUrl('/account/reset?token=abc_DEF-123')).toBe('/account/reset?token=[redacted]');
    expect(logUrl('/account/x?a=1&token=secret&b=2')).toBe('/account/x?a=1&token=[redacted]&b=2');
    expect(logUrl('/x/me')).toBe('/x/me');
    expect(logUrl('/annotations?q=token')).toBe('/annotations?q=token');
  });
});
