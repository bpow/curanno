# TODO: connect the real guest

The sidebar talks to the in-page guest only through the `Guest` interface in
[types.ts](types.ts). Every instance currently gets the fake from
[fake.ts](fake.ts) via `createGuest()` in [index.ts](index.ts). The
postMessage RPC and its message types are being built on the guest branch
(`packages/guest`, `packages/model/src/rpc/`); wiring them is the first task
after both branches merge. What to do, in order:

1. **Transport.** Add `src/guest/rpc.ts` implementing `Guest` over
   `window.parent.postMessage` with the message types from
   `@scale/model` (`rpc/`). Accept messages only from the guest's origin as
   handed over at connection time, and check `event.source === window.parent`
   on every message. Never put a token, a body, a tag or a creator in a
   message: the interface deliberately carries selectors and annotation IRIs
   only.
2. **Document identity.** Fill `document` from the guest's page report
   (URI, title, equivalent links per `docs/document-identity.md`). The
   annotations store calls `registerDocument` with it before the first
   create.
3. **Anchoring.** `anchor()` sends `{ id, target }` per annotation; the guest
   answers with one of `anchored`, `orphaned`, `ambiguous` (ADR 0010), which
   goes into the `anchoring` map keyed by IRI. `unanchor()` removes
   highlights after a delete.
4. **Selections.** The guest publishes the current selection as a
   `SpecificResource` target with `TextQuoteSelector` and
   `TextPositionSelector` (code points, ADR 0012) plus the quote for display;
   `clearSelection()` tells it to drop the selection after an annotation is
   created.
5. **Highlight focus.** `focus(ids)` on sidebar hover, `hovered` for page
   hover, `onActivate` for clicks on highlights; `scrollTo(id)` scrolls the
   page.
6. **Selection of guest.** Change `createGuest()` to return the RPC guest
   when `window.parent !== window` and a guest handshake arrives, and the
   fake otherwise (development, tests). Keep the `uri` query parameter for
   the fake only; the real document identity must come from the guest, never
   from a URL the host page controls (ADR 0007).
7. **Tests.** The component tests use `createFakeGuest()`; add a transport
   test that drives `rpc.ts` with a fake `MessageEvent` source, and extend
   the Playwright suite to load the sidebar through the guest once the
   bookmarklet exists.
