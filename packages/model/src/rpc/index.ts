/**
 * Guest/sidebar RPC protocol: message types, the envelope and the runtime
 * guards each side applies to what it receives. Specified in
 * docs/guest-sidebar-rpc.md.
 */
export { framesBelow, isFrameOf, type FrameWindow } from './frames.js';
export {
  hasEnvelope,
  parseGuestMessage,
  parseSidebarMessage,
  parseWindowMessage,
} from './guards.js';
export {
  RPC_PROTOCOL,
  RPC_PROTOCOL_VERSION,
  envelope,
  type AnchorRequest,
  type AnchorVia,
  type AnchoringResult,
  type AnchoringResultsMessage,
  type AnnotationsAnchorMessage,
  type AnnotationsUnanchorMessage,
  type DocumentLink,
  type DocumentReportMessage,
  type GuestAnchoringState,
  type GuestCapabilities,
  type GuestConnectMessage,
  type GuestDocument,
  type GuestErrorMessage,
  type GuestHelloMessage,
  type GuestMessage,
  type GuestRole,
  type GuestSelection,
  type HighlightTechnique,
  type HighlightsActivatedMessage,
  type HighlightsFocusMessage,
  type HighlightsHoveredMessage,
  type Payload,
  type RpcEnvelope,
  type RpcMessage,
  type ScrollToMessage,
  type SelectionChangedMessage,
  type SelectionClearMessage,
  type SidebarCloseMessage,
  type SidebarErrorMessage,
  type SidebarHelloMessage,
  type SidebarMessage,
  type SidebarOpenMessage,
  type SidebarReadyMessage,
  type SidebarToggleMessage,
  type SidebarVisibilityMessage,
  type TargetAnchoringResult,
  type WindowMessage,
} from './messages.js';
