/**
 * In-page guest (ADR 0007, 0008): selection, anchoring and highlights in
 * the annotated page, talking to the sidebar over the RPC protocol in
 * `@curanno/model`. This entry point is the library; `bundle.ts` is the
 * self-contained script the bookmarklet injects.
 */
export * from './anchoring/index.js';
export {
  bookmarkletSource,
  bookmarkletUrl,
  GUEST_GLOBAL,
  type BookmarkletOptions,
} from './bookmarklet.js';
export { DEFAULT_SIDEBAR_PATH, readConfig, validateSidebar, type GuestConfig } from './config.js';
export { collectDocument, collectPageMetadata } from './document-metadata.js';
export { Guest, type GuestOptions } from './guest.js';
export * from './highlights/index.js';
export * from './integrations/index.js';
export { observeMutations, WATCHED_ATTRIBUTES } from './observers/mutation.js';
export { observeSelection } from './observers/selection.js';
export {
  INJECTED_ATTRIBUTE,
  injectFrames,
  injectIntoFrame,
  type FrameInjectorOptions,
} from './frames.js';
export {
  GuestConnection,
  type Connection,
  type ConnectionOptions,
  type GuestConnectionOptions,
  type PortLike,
} from './rpc/connection.js';
export { SubGuestConnection, type SubGuestConnectionOptions } from './rpc/sub-connection.js';
export { FakeSidebar, FAKE_SECRETS, type FakeSidebarOptions } from './rpc/fake-sidebar.js';
export { SidebarFrame } from './sidebar-frame.js';
