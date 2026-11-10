import { EXTENSION_BRIDGE } from '@curanno/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionNavigator, extensionRedirectUri, listenForExtension } from './extension';

const URI = 'https://dmlkjhnoiinndnkboiknehimngilddpp.chromiumapp.org/';

function deliver(data: unknown, source: unknown = window): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin: window.location.origin,
      source: source as MessageEventSource,
    }),
  );
}

describe('extension bridge client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('believes only its own window that an extension is there', () => {
    listenForExtension();
    const ready = { bridge: EXTENSION_BRIDGE, type: 'ready', redirectUri: URI };
    deliver(ready, window.parent === window ? {} : window.parent);
    expect(extensionRedirectUri()).toBeUndefined();
    deliver(ready);
    expect(extensionRedirectUri()).toBe(URI);
  });

  it('hands the URL to the bridge and resolves with where the flow ended', async () => {
    listenForExtension();
    const posted: { id: string; url: string }[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message as { id: string; url: string });
    });
    const handle = await extensionNavigator.prepare({});
    const done = handle.navigate({ url: 'https://idp.example/auth?state=s' });
    expect(posted).toEqual([
      expect.objectContaining({ type: 'navigate', url: 'https://idp.example/auth?state=s' }),
    ]);
    const id = posted[0]!.id;
    deliver({ bridge: EXTENSION_BRIDGE, type: 'navigated', id, url: `${URI}?code=c&state=s` }, {});
    deliver({ bridge: EXTENSION_BRIDGE, type: 'navigated', id, url: `${URI}?code=c&state=s` });
    await expect(done).resolves.toEqual({ url: `${URI}?code=c&state=s` });
  });

  it('rejects with the reason the flow failed', async () => {
    listenForExtension();
    const posted: { id: string }[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message as { id: string });
    });
    const done = (await extensionNavigator.prepare({})).navigate({ url: 'https://idp.example/' });
    deliver({
      bridge: EXTENSION_BRIDGE,
      type: 'navigated',
      id: posted[0]!.id,
      error: 'The user did not approve access.',
    });
    await expect(done).rejects.toThrow('The user did not approve access.');
  });
});
