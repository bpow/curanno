# Guest/sidebar RPC protocol

**Protocol `curanno/guest-sidebar`, version 2.** How the in-page guest and the sidebar iframe talk ([ADR 0007](adr/0007-guest-sidebar-split.md)). The message types are in `packages/model/src/rpc/`, which both sides compile against; the guest side is implemented in `packages/guest/src/rpc/`, with an in-memory fake sidebar for tests and development, and the sidebar side in `apps/sidebar/src/guest/rpc.ts`. Hypothesis's `frame-sync` was the reference design; nothing was copied from it.

## 1. Principles

- **The page is untrusted.** Any script on the annotated page can read and alter what the guest does. The protocol therefore never carries anything that would hurt if the page read it: no bodies, tags, creators or tokens, in either direction. The guest sees annotation IRIs and selectors; selectors include the quoted text, which the page can see anyway.
- **One port per guest.** After discovery over `window.postMessage`, each guest talks to the sidebar over its own `MessageChannel` port. A page script that was present before the guest loaded can still hook `MessagePort.prototype.postMessage`; the first principle is what protects against that, not the port.
- **One host, any number of guests.** The guest in the frame that holds the sidebar is the **host**; guests in the page's other frames (same-origin frames the host injected the bundle into, cross-origin frames whose pages load it themselves or the extension injected it into) connect to the sidebar themselves when it announces itself to them. The sidebar keeps one connection per guest, each with its own document.
- **Strict origin checks on both sides.** The guest knows the sidebar's origin (from its configuration) and accepts `sidebar.ready` only from that origin: the host only from its own iframe's window, a guest in another frame only from a window of its own page. It sends `guest.connect` addressed to the sidebar origin, so the browser delivers its port to the sidebar and to nothing else. The sidebar cannot know the page's origin in advance, and does not take it from any message: a guest's origin is the `guest.connect` event's origin, and its role is the sender's, the host for `window.parent` and a sub-frame guest for another frame of the same top page ([ADR 0024](adr/0024-guest-origin-from-the-browser.md)). Nothing the page relays can vouch for another frame.
- **A guest speaks for its own frame only.** The sidebar refuses a `document.report` whose URI is not on the guest's origin, except from the configured PDF viewer origin, whose page reports the PDF it shows (ADR 0021). Without this a page could name any document and be sent the selectors, quoted text included, of the user's annotations on it.
- **A guest is sent its own origin's annotations.** A document may be known by addresses on several sites (document identity). The sidebar sends a guest an annotation only when its targets are on the guest's origin, when anyone may read it, when the guest is the PDF viewer, or when the user allowed that annotation's origin on the guest's origin; `highlights.focus` names only annotations the guest was sent ([ADR 0025](adr/0025-disclosure-by-origin.md)).
- **Events, not requests.** Every message is a notification; nothing waits for a reply. Ordering within one port is guaranteed by `MessageChannel`, and each side's state is replaceable (`annotations.anchor` replaces results for the same IRIs; `document.report` and `selection.changed` carry whole values), so a lost or duplicated message is harmless.
- **Versioned.** Every message carries `protocol` and `version`. A peer that receives an unknown version answers `guest.error` or `sidebar.error` and ignores the rest. Additive optional fields do not bump the version.

## 2. Envelope

Every message is a JSON object with:

| Field      | Value                                   |
| ---------- | --------------------------------------- |
| `protocol` | `"curanno/guest-sidebar"`       |
| `version`  | `1`                                     |
| `type`     | one of the types below                  |

`envelope(payload)` in `@curanno/model` adds the first two; `parseWindowMessage`, `parseSidebarMessage` and `parseGuestMessage` check a received value and return it typed, or `undefined` for anything that is not a well-formed message of the expected direction.

## 3. Connection

```
  Host page / guest                                  Sidebar iframe (our origin)
  ─────────────────                                  ───────────────────────────
  create <iframe src="https://sidebar/…">
                                                      install message handler
                            ◄── window message ───    sidebar.ready {instance}
                                                      (to window.parent, targetOrigin "*")
  check event.origin === sidebarOrigin
    and event.source === iframe.contentWindow
  create MessageChannel
  guest.connect {guestId}  ─── window message ──►     check event.source === window.parent
  (to iframe.contentWindow, targetOrigin             remember event.origin as the guest's
   sidebarOrigin, transfer port2)                    origin; keep the port
  ═══════════════════ everything below travels over the port ═══════════════════
  guest.hello {guestId, capabilities} ──────────►
                            ◄──────────────────       sidebar.hello
  document.report {document} ───────────────────►     registerDocument, load annotations
                            ◄──────────────────       annotations.anchor {requests}
  anchor each request, draw highlights
  anchoring.results {results} ──────────────────►     show anchored / orphaned / ambiguous
```

The sidebar sends `sidebar.ready` again when it reloads, with a new `instance`; the host then discards the old port, connects a new one and repeats `guest.hello` and `document.report`, and the page's other frames reconnect the same way (below). A guest sends nothing over a port before `sidebar.hello` arrives on it, except `guest.hello`. A `guest.connect` with a known `guestId` (a reloaded frame, or a page script posing as it) replaces that guest's port: the sidebar forgets its results and, once the new guest reports its document, sends `annotations.anchor` again for every annotation of that document it has asked to anchor and not withdrawn, so the new guest draws what the old one did.

### Guests in other frames

```
  Child frame / guest                                 Sidebar iframe (in the host's closed shadow root)
  ───────────────────                                 ─────────────────────────────────────────────────
                     ◄── window message ───           sidebar.ready {instance}
                                                      (to every frame below window.top, target "*",
                                                       again every second)
  check event.origin === sidebarOrigin
    and event.source.top === window.top
  ignore if connected to this instance
  create MessageChannel
  guest.connect {guestId} ─── window message ──►      check event.source.top === window.top,
  (to event.source, targetOrigin sidebarOrigin,         window.parent === window.top;
   transfer port2)                                    the guest's origin is event.origin
  ═══════ the same port protocol as the host's, from guest.hello on ═══════
                                                      frame closed (polled): forget the guest
```

The guest cannot start the conversation: the sidebar's frame sits in the host's closed shadow root, and browsers leave such frames out of `window.frames`, so nothing in the page can find it. The sidebar can reach every other frame through `window.top`, whose `length` and indexed children are readable across origins, so it announces itself to them, now and every second for frames that load later; `instance` lets a connected guest ignore the repeats and reconnect when the sidebar reloads. Only the top page's sidebar announces itself to frames and accepts their connects, and only from frames whose `top` is its own (frames of the page, not popups or openers). A frame has one guest: a connect from a window that already has one replaces it, as after the frame navigates, and the sidebar forgets the guests of frames whose windows closed. The host injects the bundle into same-origin frames itself (and again when one navigates); a cross-origin frame's page has to load the guest, or the extension injects it (ADR 0023). A guest in a frame shows no sidebar of its own, so the sidebar sends `sidebar.open`, `sidebar.close` and `sidebar.toggle` to the host only.

## 4. Steady state

```
  Guest                                              Sidebar
  user selects text
  selection.changed {selection} ────────────────►    offer "annotate"
                            ◄──────────────────      (annotation created through the API)
                            ◄──────────────────      selection.clear
                            ◄──────────────────      annotations.anchor {requests: [new one]}
  anchoring.results ────────────────────────────►
  user clicks a highlight
  highlights.activated {ids} ───────────────────►    scroll to and expand the cards
  pointer over a highlight
  highlights.hovered {ids} ─────────────────────►    emphasise the cards
                            ◄──────────────────      highlights.focus {ids}   (card hover)
                            ◄──────────────────      highlights.visible {visible}
                            ◄──────────────────      scroll.to {id}
  page DOM changes
  re-extract, re-anchor, redraw
  anchoring.results {changed results only} ─────►
                            ◄──────────────────      sidebar.close / sidebar.open / sidebar.toggle
  sidebar.visibility {open} ────────────────────►
                            ◄──────────────────      text.request {requestId}   (curator asks for suggestions)
  text.report {requestId, scopes} ──────────────►    run the model, then
                            ◄──────────────────      annotations.anchor {requests: [{…, style: "suggested"}]}
```

Suggestions ([ADR 0033](adr/0033-guest-reports-document-text.md)) are the one place text crosses the port: the guest sends its document's text to the sidebar, which the page already has, and the sidebar sends back only selectors under `urn:uuid:` identifiers. Neither the model's output nor the endpoint reaches the page.

## 5. Messages

### Window messages (discovery)

| Type               | Direction        | Fields                   | Notes                                                                                            |
| ------------------ | ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `sidebar.ready`    | sidebar → parent, frames | `instance` | Sent with target origin `*` to the parent once and to every frame of the top page every second; `instance` is random per sidebar load. Carries nothing a page could use. |
| `guest.connect`    | guest → sidebar  | `guestId`                | Sent by each guest to the window that sent `sidebar.ready`, with the sidebar origin as target; transfers one `MessagePort`. |

### Guest → sidebar (over the port)

| Type                   | Fields                   | Notes                                                                                                        |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `guest.hello`          | `guestId`, `capabilities` | First message on a port. `capabilities.highlights` is `css-highlight` or `overlay`; `capabilities.text` is `true` when the guest answers `text.request`. (Version 1 also had `capabilities.role`; the sidebar now takes the role from the sender.) |
| `document.report`      | `document`               | `{uri, title?, links}`; `links` are `{uri, relation}` exactly as found, from `deriveDocumentUris`.           |
| `anchoring.results`    | `results`                | One `AnchoringResult` per annotation: `id`, overall `state`, and one `TargetAnchoringResult` per target.     |
| `selection.changed`    | `selection` or `null`    | `{target, quote}`; `target` is a `SpecificResource` with the page URL as `source` and the three selectors.   |
| `highlights.hovered`   | `ids`                    | Annotations under the pointer; `[]` when it leaves them.                                                     |
| `highlights.activated` | `ids`                    | Annotations under a click.                                                                                   |
| `sidebar.visibility`   | `open`                   | After any open, close or toggle, whoever asked.                                                              |
| `text.report`          | `requestId`, `scopes`    | Answers `text.request`. One `{text, blockStarts?, page?}` per scope: the body's normalized text for a page, each page's for a PDF (`page` is 1-based). `blockStarts` are code point offsets where blocks begin, for presenting the text; selectors never use them. |
| `guest.error`          | `message`, `inReplyTo?`  | A sidebar message could not be handled, or the version is unknown.                                           |

`AnchoringResult.state` is `anchored` when any target anchored, otherwise `ambiguous` when any target was, otherwise `orphaned` ([ADR 0010](adr/0010-keep-original-selectors.md)). A target without text selectors (the whole page) anchors with no `range`. Per-target results carry the code point `range` ([ADR 0012](adr/0012-code-point-offsets.md)), how it was found (`via`: `range`, `position` or `quote`) and the quote match `score`, or the `candidates` of an ambiguous match, or the `reason` for an orphan. For a PDF target, whose selectors are scoped to the page a `FragmentSelector` names, `range` counts that page's text; when the text was found on another page of a revised file, `page` says which.

### Sidebar → guest (over the port)

| Type                    | Fields                  | Notes                                                                                                   |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `sidebar.hello`         | —                       | Acknowledges `guest.hello`.                                                                             |
| `annotations.anchor`    | `requests`              | `{id, target, style?}` each; `target` is the annotation's targets or a repair's. Replaces results for those IRIs. `style: "suggested"` marks a suggestion that is not saved, drawn dashed. |
| `annotations.unanchor`  | `ids`                   | Removes highlights and results.                                                                         |
| `highlights.focus`      | `ids`                   | Emphasises these highlights; `[]` clears.                                                               |
| `highlights.visible`    | `visible`               | Hides (`false`) or shows every highlight. Hidden highlights stay anchored but are not hovered or clicked. Sent after `sidebar.hello` to a guest that connects while they are hidden. |
| `scroll.to`             | `id`                    | Scrolls the page to the annotation's first highlight.                                                   |
| `selection.clear`       | —                       | Drops the selection; the guest answers `selection.changed {null}`.                                      |
| `text.request`          | `requestId`             | Asks for `text.report`. Sent only to a guest whose capabilities include `text`.                          |
| `sidebar.open`, `sidebar.close`, `sidebar.toggle` | — | The guest shows or hides the frame and answers `sidebar.visibility`.                          |
| `sidebar.error`         | `message`, `inReplyTo?` | A guest message could not be handled.                                                                   |

## 6. What the sidebar's guest interface maps to

The sidebar's `Guest` interface (`apps/sidebar/src/guest/types.ts`) is a view of this protocol over every connected guest:

| Sidebar interface              | Protocol                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `document`                     | the host's last `document.report`                                                          |
| `documents`                    | every guest's last `document.report`, the host's first, one per URI                        |
| `selection`                    | the last `selection.changed` from any guest, with that guest's document                    |
| `anchoring` (IRI → state)      | `anchoring.results` from every guest, merged by `id`, the best state winning               |
| `hovered`                      | the union of the guests' last `highlights.hovered`                                         |
| `anchor(requests, documentUri)` | `annotations.anchor` to the guests showing that document, now and when one reports it      |
| `unanchor(ids)`                | `annotations.unanchor` to the guests that were asked                                       |
| `focus(ids)`                   | `highlights.focus` to every guest                                                          |
| `showHighlights(visible)`      | `highlights.visible` to every guest, now and when one connects                             |
| `scrollTo(id)`                 | `scroll.to` to the guests that were asked to anchor it                                     |
| `clearSelection()`             | `selection.clear` to the guest whose selection it is                                       |
| `onActivate(handler)`          | `highlights.activated` from any guest                                                      |
| `textDocuments`                | the documents whose guest advertised `capabilities.text`                                   |
| `requestText(documentUri)`     | `text.request` to a guest showing that document; resolves with its `text.report`           |

## 7. Threats considered

- **The page reads the traffic.** It can, by hooking `postMessage` before the guest loads or by reading the guest's state. The traffic holds nothing beyond selectors and IRIs; the hostile-page tests in `packages/guest/test/browser/isolation.test.ts` (fake sidebar) and `apps/sidebar/e2e/guest/hostile.spec.ts` (the real sidebar with a seeded token, a body, a tag and a creator) check that none of those appear in anything the page can observe, and that no message carries a `body`, `creator`, `tags`, `token` or `authorization` field.
- **The page impersonates the guest.** It can send its own `guest.connect` to the sidebar, whose window it learns as the source of `sidebar.ready`. It is then a guest on the page's own origin and receives what any guest there receives: IRIs and selectors of annotations the sidebar's user may read on documents of that origin, which the real guest would have shown as highlights there; a report of a document on another origin is refused (section 1). It cannot read bodies, act as the user or obtain a token, because the sidebar never sends those and takes no instruction from the guest beyond anchoring, scrolling and visibility.
- **The page speaks for another frame.** Version 1 let the host relay other frames' connects with their origin in `frameOrigin`, and the sidebar believed it; a page could claim any origin, the PDF viewer's included, and be sent the selectors of the user's annotations on any document (security review, finding 21). Since version 2 the sidebar takes origins only from the browser, so whatever the page posts, it posts as itself (ADR 0024).
- **A frame impersonates another frame.** A frame's guest connects from its own window, so the sidebar sees that frame's real origin and holds it to documents on that origin. A hostile frame cannot pose as the sidebar to another frame's guest either: guests answer `sidebar.ready` only from the sidebar origin, and send their port addressed to that origin.
- **Third-party frames hear the announcement.** `sidebar.ready` goes to every frame of the page, so a frame from another site learns that a sidebar is open and its instance id, and nothing more. It can connect as a guest on its own origin, as above.
- **The page impersonates the sidebar.** The guest accepts `sidebar.ready` only from its own iframe's window at the configured origin, and port messages only on the port it created, so a page script cannot make the guest highlight or scroll on its behalf through this channel (it can through the DOM, which is outside the guest's control).
- **The page hides or covers the frame.** Out of scope for the protocol; `frame-ancestors` and visibility checks are the sidebar's defences.
- **The page lies about its text.** A `text.report` is the page's own content, which a hostile page can make anything. Suggestions made from it are shown only to the user who asked, on that page, and nothing is saved until they accept one; the quoted text becomes the selectors of an annotation on that page, as a selection would.
- **Page-supplied configuration.** The guest reads only the sidebar origin and path from its injection; nothing in the protocol lets the page grant a login ([ADR 0007](adr/0007-guest-sidebar-split.md)).
