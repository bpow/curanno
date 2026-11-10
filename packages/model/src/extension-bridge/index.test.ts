import { describe, expect, it } from 'vitest';
import {
  EXTENSION_BRIDGE,
  extensionRedirectUri,
  isExtensionRedirectUri,
  parseBridgeMessage,
} from './index.js';

const ID = 'dmlkjhnoiinndnkboiknehimngilddpp';

describe('extension bridge messages', () => {
  it('accepts only a chromiumapp.org redirect URI of an extension id', () => {
    expect(isExtensionRedirectUri(extensionRedirectUri(ID))).toBe(true);
    expect(isExtensionRedirectUri(`https://${ID}.chromiumapp.org/x`)).toBe(false);
    expect(isExtensionRedirectUri('https://evil.example/')).toBe(false);
    expect(isExtensionRedirectUri(`https://${ID}.chromiumapp.org.evil.example/`)).toBe(false);
  });

  it('parses each type and drops extra fields', () => {
    const ready = {
      bridge: EXTENSION_BRIDGE,
      type: 'ready',
      redirectUri: extensionRedirectUri(ID),
    };
    expect(parseBridgeMessage({ ...ready, extra: 1 })).toEqual(ready);
    expect(parseBridgeMessage({ bridge: EXTENSION_BRIDGE, type: 'query' })).toEqual({
      bridge: EXTENSION_BRIDGE,
      type: 'query',
    });
    const navigate = { bridge: EXTENSION_BRIDGE, type: 'navigate', id: 'a', url: 'https://idp/' };
    expect(parseBridgeMessage(navigate)).toEqual(navigate);
    const failed = { bridge: EXTENSION_BRIDGE, type: 'navigated', id: 'a', error: 'closed' };
    expect(parseBridgeMessage(failed)).toEqual(failed);
  });

  it('rejects malformed messages', () => {
    expect(parseBridgeMessage({ type: 'query' })).toBeUndefined();
    expect(parseBridgeMessage({ bridge: EXTENSION_BRIDGE, type: 'other' })).toBeUndefined();
    expect(
      parseBridgeMessage({ bridge: EXTENSION_BRIDGE, type: 'ready', redirectUri: 'https://x/' }),
    ).toBeUndefined();
    expect(
      parseBridgeMessage({ bridge: EXTENSION_BRIDGE, type: 'navigated', id: 'a' }),
    ).toBeUndefined();
    expect(parseBridgeMessage(null)).toBeUndefined();
  });
});
