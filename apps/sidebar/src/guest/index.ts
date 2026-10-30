import { inject, provide, type InjectionKey } from 'vue';
import { createFakeGuest, documentFromLocation, type FakeGuest } from './fake';
import type { Guest } from './types';

export * from './types';
export { createFakeGuest, documentFromLocation, type FakeGuest } from './fake';

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
 * The guest this sidebar instance talks to. Until the postMessage transport
 * exists (TODO.md) every instance gets the fake, with the document taken
 * from the `uri` query parameter.
 */
export function createGuest(): Guest {
  return createFakeGuest({ document: documentFromLocation() });
}
