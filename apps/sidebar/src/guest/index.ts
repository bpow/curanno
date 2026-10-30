import { inject, provide, type InjectionKey } from 'vue';
import { createFakeGuest, documentFromLocation, type FakeGuest } from './fake';
import { config } from '../config';
import { createRpcGuest } from './rpc';
import type { Guest } from './types';

export * from './types';
export { createFakeGuest, documentFromLocation, type FakeGuest } from './fake';
export {
  createRpcGuest,
  mayReport,
  type ConnectedGuest,
  type RpcGuest,
  type RpcGuestOptions,
} from './rpc';

export const GUEST_KEY: InjectionKey<Guest> = Symbol('guest');

export function provideGuest(guest: Guest): void {
  provide(GUEST_KEY, guest);
}

export function useGuest(): Guest {
  const guest = inject(GUEST_KEY);
  if (!guest) throw new Error('no guest provided');
  return guest;
}

export function isFakeGuest(guest: Guest): guest is FakeGuest {
  return 'select' in guest;
}

/**
 * The guest this sidebar instance talks to: the real one over the RPC when
 * the sidebar is framed, where the document's identity comes from the
 * guest's report and never from the URL (ADR 0007); the fake when it runs
 * top-level (development, tests), where the `uri` query parameter picks the
 * document.
 */
export function createGuest(win: Window = window): Guest {
  if (win.parent !== win) {
    return createRpcGuest({
      window: win,
      trustedOrigins: config.pdfViewerOrigin ? [config.pdfViewerOrigin] : [],
    });
  }
  return createFakeGuest({ document: documentFromLocation(win.location.search) });
}
