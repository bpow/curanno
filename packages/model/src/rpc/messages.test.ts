import { describe, expect, it } from 'vitest';
import { parseGuestMessage, parseSidebarMessage, parseWindowMessage } from './guards.js';
import {
  RPC_PROTOCOL,
  RPC_PROTOCOL_VERSION,
  envelope,
  type AnnotationsAnchorMessage,
  type GuestConnectMessage,
  type SelectionChangedMessage,
  type TextReportMessage,
} from './messages.js';

describe('envelope', () => {
  it('stamps the protocol and version on a payload', () => {
    const message = envelope<GuestConnectMessage>({ type: 'guest.connect', guestId: 'g1' });
    expect(message).toEqual({
      protocol: RPC_PROTOCOL,
      version: RPC_PROTOCOL_VERSION,
      type: 'guest.connect',
      guestId: 'g1',
    });
    expect(parseWindowMessage(message)).toEqual(message);
  });
});

describe('guards', () => {
  it('reject anything without the envelope or with an unknown type', () => {
    expect(parseSidebarMessage({ type: 'sidebar.hello' })).toBeUndefined();
    expect(parseSidebarMessage(envelope({ type: 'guest.hello' }))).toBeUndefined();
    expect(parseGuestMessage(envelope({ type: 'sidebar.hello' }))).toBeUndefined();
    expect(parseWindowMessage('sidebar.ready')).toBeUndefined();
    expect(parseWindowMessage(null)).toBeUndefined();
  });

  it('check the shape of anchor requests', () => {
    const good = envelope<AnnotationsAnchorMessage>({
      type: 'annotations.anchor',
      requests: [
        { id: 'urn:a1', target: 'https://example.org/page' },
        { id: 'urn:a2', target: [{ source: 'https://example.org/page' }] },
      ],
    });
    expect(parseSidebarMessage(good)).toEqual(good);
    expect(
      parseSidebarMessage(envelope({ type: 'annotations.anchor', requests: [{ id: 1 }] })),
    ).toBeUndefined();
    expect(parseSidebarMessage(envelope({ type: 'highlights.focus', ids: 'a' }))).toBeUndefined();
    expect(parseSidebarMessage(envelope({ type: 'scroll.to', id: 'urn:a1' }))).toBeDefined();
    expect(
      parseSidebarMessage(envelope({ type: 'highlights.visible', visible: false })),
    ).toBeDefined();
    expect(
      parseSidebarMessage(envelope({ type: 'highlights.visible', visible: 'no' })),
    ).toBeUndefined();
  });

  it('check anchoring results and selections from the guest', () => {
    expect(
      parseGuestMessage(
        envelope({
          type: 'anchoring.results',
          results: [
            {
              id: 'a',
              state: 'anchored',
              targets: [{ state: 'anchored', range: { start: 1, end: 2 } }],
            },
            { id: 'b', state: 'orphaned', targets: [{ state: 'orphaned', reason: 'gone' }] },
            { id: 'c', state: 'ambiguous', targets: [{ state: 'ambiguous', candidates: [] }] },
          ],
        }),
      ),
    ).toBeDefined();
    expect(
      parseGuestMessage(
        envelope({
          type: 'anchoring.results',
          results: [{ id: 'a', state: 'repaired', targets: [] }],
        }),
      ),
    ).toBeUndefined();
    const selection = envelope<SelectionChangedMessage>({
      type: 'selection.changed',
      selection: {
        quote: 'words',
        target: {
          source: 'https://example.org/p',
          selector: { type: 'TextQuoteSelector', exact: 'words' },
        },
      },
    });
    expect(parseGuestMessage(selection)).toEqual(selection);
    expect(
      parseGuestMessage(envelope({ type: 'selection.changed', selection: null })),
    ).toBeDefined();
    expect(parseGuestMessage(envelope({ type: 'selection.changed' }))).toBeUndefined();
  });

  it('check text requests, reports and the suggested style', () => {
    expect(parseSidebarMessage(envelope({ type: 'text.request', requestId: 'r1' }))).toBeDefined();
    expect(parseSidebarMessage(envelope({ type: 'text.request' }))).toBeUndefined();
    const report = envelope<TextReportMessage>({
      type: 'text.report',
      requestId: 'r1',
      scopes: [
        { text: 'page one', page: 1 },
        { text: 'onetwo', blockStarts: [3] },
      ],
    });
    expect(parseGuestMessage(report)).toEqual(report);
    for (const scopes of [
      [{ text: 1 }],
      [{ text: 'x', page: 0 }],
      [{ text: 'x', blockStarts: [-1] }],
      [{ text: 'x', blockStarts: 'all' }],
      'text',
    ]) {
      expect(
        parseGuestMessage(envelope({ type: 'text.report', requestId: 'r1', scopes })),
      ).toBeUndefined();
    }
    const suggested = { id: 'urn:uuid:1', target: 'https://example.org/p', style: 'suggested' };
    expect(
      parseSidebarMessage(envelope({ type: 'annotations.anchor', requests: [suggested] })),
    ).toBeDefined();
    expect(
      parseSidebarMessage(
        envelope({ type: 'annotations.anchor', requests: [{ ...suggested, style: 'loud' }] }),
      ),
    ).toBeUndefined();
  });
});
