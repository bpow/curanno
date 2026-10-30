/** Globals the bundles install in the pages the tests drive. */
import type { GuestHandle } from '../../src/bundle.ts';
import type { FakeSidebar } from '../../src/rpc/fake-sidebar.ts';

declare global {
  interface Window {
    __fakeSidebar: FakeSidebar;
    __curannoGuest?: GuestHandle;
  }
}
