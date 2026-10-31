# 0024. A guest's origin comes from the browser, and every guest connects to the sidebar itself

**Status:** Accepted

**Date:** 2026-10-31

## Context

The sidebar holds each guest to documents on the guest's own origin (security review, finding 1), because a guest that could name any document would be sent the selectors, quoted text included, of the user's annotations on it. That rule is only as good as the origin the sidebar attributes to the guest.

In protocol version 1 a guest in another frame could not reach the sidebar, so it asked the host in the top frame, which made a channel and posted `guest.connect` to the sidebar with the frame's origin in `frameOrigin`. The sidebar checked that the message came from `window.parent` and believed `frameOrigin`. The host is the annotated page, though, and the page can post the same message: it learns the sidebar's window as the source of `sidebar.ready`, and in the extension its scripts share the window with the content script even though they do not share its objects. A page could therefore claim any origin, the PDF viewer's included, which may report any document, and be sent the selectors of the user's annotations on another site (code review of 2026-10-30, finding 1; security review, finding 21). The protocol's threat model had dismissed a relaying page as "the previous case", which it was not.

Options considered:

- **Sub-frame guests find the sidebar and connect to it directly.** The sidebar's frame is in the host's closed shadow root, and browsers leave such frames out of `window.frames` (checked in Chromium), so a frame has no way to reach it.
- **The extension's own messaging.** `chrome.runtime` reports the sender frame's real origin, but only for content scripts; the bookmarklet and same-origin injection would still need another path, and the protocol would have two transports.
- **The sidebar announces itself to the page's frames.** The sidebar can reach every frame below `window.top`, whose `length` and indexed children are readable across origins, and post to it. A guest that hears `sidebar.ready` from the sidebar origin answers the event's source with its own `guest.connect`, addressed to the sidebar origin, so the browser both delivers the port only to the sidebar and reports the frame's real origin to it.

## Decision

- The sidebar takes a guest's origin only from the `guest.connect` event's origin, and its role only from the sender: `window.parent` is the host; another window whose `top` is the sidebar's `top` is a sub-frame guest, accepted only when the sidebar's parent is the top window. No message field names an origin or a role; `frameOrigin` and `capabilities.role` are gone.
- The sidebar posts `sidebar.ready` with target origin `*` to its parent once and to every frame below the top window every second, carrying a random `instance` per load. A sub-frame guest accepts it only from the sidebar origin and from a window of its own page, ignores repeats of the instance it is connected to, and reconnects on a new one.
- The host no longer relays: `guest.discover`, `host.port`, `host.ready` and `guest.disconnect` are removed. The sidebar forgets guests whose windows closed, and replaces the guest of a window that connects again.
- The protocol version becomes 2. The bookmarklet bundle ships with the deployment; the extension, which carries its own guest (ADR 0023), needs a release with it.
- The PDF viewer keeps its trust (ADR 0021) on the same footing: its origin is the browser's report of its own frame.

## Consequences

- What a page posts to the sidebar, it posts as itself: it can be a guest on its own origin and nothing else, so finding 1's rule holds whatever the page does.
- A guest in a frame no longer depends on, or can be misled by, the page around it: it sends its port only to a window the browser confirms is on the sidebar origin. The version 1 risk that a hostile page could hand a frame's guest a fake sidebar is gone with the relay.
- Every frame of the page, third-party ones included, receives `sidebar.ready` every second while the sidebar is open. It reveals that a sidebar is open and nothing else; the cost is one small message per frame per second.
- A frame whose guest starts between announcements waits up to a second to connect.
- Disclosing an aliased document's selectors to a page on another origin (code review of 2026-10-30, finding 2) is a separate decision; it rests on the verified origin this ADR provides.

## References

- [Guest/sidebar RPC protocol](../guest-sidebar-rpc.md), sections 1, 3 and 7
- [Security review](../security-review.md), findings 1 and 21
- ADR 0007, ADR 0021, ADR 0023
