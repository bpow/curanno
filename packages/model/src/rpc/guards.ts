/**
 * Runtime checks for messages received over `postMessage`. Each side
 * accepts only messages that carry the protocol envelope, a type it
 * expects from its peer and fields of the right shape; anything else is
 * dropped. Selectors and targets are checked structurally, not against
 * the JSON Schemas (the guest must stay small, ADR 0008).
 */
import {
  RPC_PROTOCOL,
  type AnchorRequest,
  type AnchoringResult,
  type GuestMessage,
  type GuestSelection,
  type RpcEnvelope,
  type SidebarMessage,
  type WindowMessage,
} from './messages.js';

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Whether `data` carries this protocol's envelope. The version is checked by the handshake. */
export function hasEnvelope(data: unknown): data is RpcEnvelope & Dict {
  return isDict(data) && data['protocol'] === RPC_PROTOCOL && typeof data['version'] === 'number';
}

export function parseWindowMessage(data: unknown): WindowMessage | undefined {
  if (!hasEnvelope(data)) return undefined;
  switch (data['type']) {
    case 'sidebar.ready':
      return typeof data['instance'] === 'string' ? (data as unknown as WindowMessage) : undefined;
    case 'guest.connect':
      return typeof data['guestId'] === 'string' ? (data as unknown as WindowMessage) : undefined;
    default:
      return undefined;
  }
}

function isAnchorRequest(value: unknown): value is AnchorRequest {
  if (!isDict(value) || typeof value['id'] !== 'string') return false;
  const target = value['target'];
  const one = (t: unknown): boolean => typeof t === 'string' || isDict(t);
  return Array.isArray(target) ? target.every(one) : one(target);
}

/** A message from the sidebar, as the guest should accept it. */
export function parseSidebarMessage(data: unknown): SidebarMessage | undefined {
  if (!hasEnvelope(data)) return undefined;
  const ok = (): SidebarMessage => data as unknown as SidebarMessage;
  switch (data['type']) {
    case 'sidebar.hello':
    case 'selection.clear':
    case 'sidebar.open':
    case 'sidebar.close':
    case 'sidebar.toggle':
      return ok();
    case 'annotations.anchor':
      return Array.isArray(data['requests']) && data['requests'].every(isAnchorRequest)
        ? ok()
        : undefined;
    case 'annotations.unanchor':
    case 'highlights.focus':
      return isStringArray(data['ids']) ? ok() : undefined;
    case 'scroll.to':
      return typeof data['id'] === 'string' ? ok() : undefined;
    case 'sidebar.error':
      return typeof data['message'] === 'string' ? ok() : undefined;
    default:
      return undefined;
  }
}

function isTextRange(value: unknown): boolean {
  return isDict(value) && typeof value['start'] === 'number' && typeof value['end'] === 'number';
}

function isAnchoringResult(value: unknown): value is AnchoringResult {
  if (!isDict(value) || typeof value['id'] !== 'string') return false;
  if (!['anchored', 'orphaned', 'ambiguous'].includes(value['state'] as string)) return false;
  const targets = value['targets'];
  return (
    Array.isArray(targets) &&
    targets.every((t: unknown) => {
      if (!isDict(t)) return false;
      switch (t['state']) {
        case 'anchored':
          return (
            (t['range'] === undefined || isTextRange(t['range'])) &&
            (t['page'] === undefined || typeof t['page'] === 'number')
          );
        case 'ambiguous':
          return Array.isArray(t['candidates']) && t['candidates'].every(isTextRange);
        case 'orphaned':
          return typeof t['reason'] === 'string';
        default:
          return false;
      }
    })
  );
}

function isSelection(value: unknown): value is GuestSelection {
  return (
    isDict(value) &&
    typeof value['quote'] === 'string' &&
    isDict(value['target']) &&
    typeof value['target']['source'] === 'string'
  );
}

/** A message from the guest, as the sidebar should accept it. */
export function parseGuestMessage(data: unknown): GuestMessage | undefined {
  if (!hasEnvelope(data)) return undefined;
  const ok = (): GuestMessage => data as unknown as GuestMessage;
  switch (data['type']) {
    case 'guest.hello':
      return typeof data['guestId'] === 'string' && isDict(data['capabilities']) ? ok() : undefined;
    case 'document.report': {
      const doc = data['document'];
      return isDict(doc) && typeof doc['uri'] === 'string' && Array.isArray(doc['links'])
        ? ok()
        : undefined;
    }
    case 'anchoring.results':
      return Array.isArray(data['results']) && data['results'].every(isAnchoringResult)
        ? ok()
        : undefined;
    case 'selection.changed':
      return data['selection'] === null || isSelection(data['selection']) ? ok() : undefined;
    case 'highlights.hovered':
    case 'highlights.activated':
      return isStringArray(data['ids']) ? ok() : undefined;
    case 'sidebar.visibility':
      return typeof data['open'] === 'boolean' ? ok() : undefined;
    case 'guest.error':
      return typeof data['message'] === 'string' ? ok() : undefined;
    default:
      return undefined;
  }
}
