# Guest/sidebar RPC protocol

**Protocol `curanno/guest-sidebar`, version 1.** How the in-page guest and the sidebar iframe talk ([ADR 0007](adr/0007-guest-sidebar-split.md)). The message types are in `packages/model/src/rpc/`, which both sides compile against; the guest side is implemented in `packages/guest/src/rpc/`, with an in-memory fake sidebar for tests and development, and the sidebar side in `apps/sidebar/src/guest/rpc.ts`. Hypothesis's `frame-sync` was the reference design; nothing was copied from it.

## 1. Principles

- **The page is untrusted.** Any script on the annotated page can read and alter what the guest does. The protocol therefore never carries anything that would hurt if the page read it: no bodies, tags, creators or tokens, in either direction. The guest sees annotation IRIs and selectors; selectors include the quoted text, which the page can see anyway.
- **One port per guest.** After discovery over `window.postMessage`, each guest talks to the sidebar over its own `MessageChannel` port. A page script that was present before the guest loaded can still hook `MessagePort.prototype.postMessage`; the first principle is what protects against that, not the port.
- **One host, any number of guests.** The guest in the frame that holds the sidebar is the **host**; guests in the page's other frames (same-origin frames the host injected the bundle into, cross-origin frames whose pages load it themselves, our PDF viewer when embedded) get their ports from the host, which never reads their traffic. The sidebar keeps one connection per guest, each with its own document.
- **Strict origin checks on the guest.** The guest knows the sidebar's origin (from the bookmarklet configuration) and accepts window messages only from that origin and only from its own iframe's window. The sidebar cannot know the page's origin in advance; it accepts `guest.connect` only from `window.parent` (the host) and learns each guest's origin from that message: the event's origin for the host itself, `frameOrigin` for a guest the host relays, which the host took from the frame's own `guest.discover` event.
- **A guest speaks for its own frame only.** The sidebar refuses a `document.report` whose URI is not on the guest's origin, except from the configured PDF viewer origin, whose page reports the PDF it shows (ADR 0021). Without this a page could name any document and be sent the selectors, quoted text included, of the user's annotations on it.
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
                            ◄── window message ───    sidebar.ready
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

The sidebar may send `sidebar.ready` again (after a reload, say); the host then discards the old port, connects a new one and repeats `guest.hello` and `document.report`, and tells the page's other frames with `host.ready` so their guests reconnect too. A guest sends nothing over a port before `sidebar.hello` arrives on it, except `guest.hello`. A `guest.connect` with a known `guestId` (a reloaded frame, or a page script posing as it) replaces that guest's port: the sidebar forgets its results and, once the new guest reports its document, sends `annotations.anchor` again for every annotation of that document it has asked to anchor and not withdrawn, so the new guest draws what the old one did.

### Guests in other frames

```
  Child frame / guest                 Top frame / host                     Sidebar iframe
  ───────────────────                 ────────────────                     ──────────────
  guest.discover {guestId} ──────►    check event.source.top === window
  (to window.top, targetOrigin "*";   create MessageChannel
   again on host.ready, and at        guest.connect {guestId, frameOrigin: event.origin}
   intervals until a port comes)        ─── window message, transfer port2 ───────────►
                      ◄── host.port {guestId} ── (to the frame, targetOrigin event.origin,
                                                   transfer port1)
  check event.source === window.top
  ═══════ the same port protocol as the host's, from guest.hello on ═══════
                                      frame closed (polled): guest.disconnect {guestId} ─►
```

The host answers `guest.discover` only from windows whose `top` is itself (frames of its page, not popups) and only while its sidebar is ready; otherwise the frame asks again when `host.ready` arrives. The host injects the bundle into same-origin frames itself (and again when one navigates); a cross-origin frame's page has to load the guest. A guest in a frame shows no sidebar of its own and reports `role: "sub"` in `guest.hello`, so the sidebar sends `sidebar.open`, `sidebar.close` and `sidebar.toggle` to the host only.

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
                            ◄──────────────────      scroll.to {id}
  page DOM changes
  re-extract, re-anchor, redraw
  anchoring.results {changed results only} ─────►
                            ◄──────────────────      sidebar.close / sidebar.open / sidebar.toggle
  sidebar.visibility {open} ────────────────────►
```

## 5. Messages

### Window messages (discovery)

| Type               | Direction        | Fields                   | Notes                                                                                            |
| ------------------ | ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `sidebar.ready`    | sidebar → parent | —                        | Sent with target origin `*`; carries nothing a page could use.                                   |
| `guest.connect`    | host → sidebar   | `guestId`, `frameOrigin?` | Sent with the sidebar origin as target; transfers one `MessagePort`. `frameOrigin` names the frame of a relayed guest. |
| `guest.disconnect` | host → sidebar   | `guestId`                | The frame of a relayed guest closed; the sidebar forgets it.                                     |
| `guest.discover`   | guest → top      | `guestId`                | A guest in a frame asks the host for a port; target origin `*`.                                  |
| `host.port`        | host → frame     | `guestId`                | The answer, with the frame's origin as target; transfers the guest's end of the channel.         |
| `host.ready`       | host → frames    | —                        | The host's sidebar takes connections; sent to every frame with target origin `*`.                |

### Guest → sidebar (over the port)

| Type                   | Fields                   | Notes                                                                                                        |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `guest.hello`          | `guestId`, `capabilities` | First message on a port. `capabilities.highlights` is `css-highlight` or `overlay`; `capabilities.role` is `host` (default) or `sub`. |
| `document.report`      | `document`               | `{uri, title?, links}`; `links` are `{uri, relation}` exactly as found, from `deriveDocumentUris`.           |
| `anchoring.results`    | `results`                | One `AnchoringResult` per annotation: `id`, overall `state`, and one `TargetAnchoringResult` per target.     |
| `selection.changed`    | `selection` or `null`    | `{target, quote}`; `target` is a `SpecificResource` with the page URL as `source` and the three selectors.   |
| `highlights.hovered`   | `ids`                    | Annotations under the pointer; `[]` when it leaves them.                                                     |
| `highlights.activated` | `ids`                    | Annotations under a click.                                                                                   |
| `sidebar.visibility`   | `open`                   | After any open, close or toggle, whoever asked.                                                              |
| `guest.error`          | `message`, `inReplyTo?`  | A sidebar message could not be handled, or the version is unknown.                                           |

`AnchoringResult.state` is `anchored` when any target anchored, otherwise `ambiguous` when any target was, otherwise `orphaned` ([ADR 0010](adr/0010-keep-original-selectors.md)). A target without text selectors (the whole page) anchors with no `range`. Per-target results carry the code point `range` ([ADR 0012](adr/0012-code-point-offsets.md)), how it was found (`via`: `range`, `position` or `quote`) and the quote match `score`, or the `candidates` of an ambiguous match, or the `reason` for an orphan. For a PDF target, whose selectors are scoped to the page a `FragmentSelector` names, `range` counts that page's text; when the text was found on another page of a revised file, `page` says which.

### Sidebar → guest (over the port)

| Type                    | Fields                  | Notes                                                                                                   |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `sidebar.hello`         | —                       | Acknowledges `guest.hello`.                                                                             |
| `annotations.anchor`    | `requests`              | `{id, target}` each; `target` is the annotation's targets or a repair's. Replaces results for those IRIs. |
| `annotations.unanchor`  | `ids`                   | Removes highlights and results.                                                                         |
| `highlights.focus`      | `ids`                   | Emphasises these highlights; `[]` clears.                                                               |
| `scroll.to`             | `id`                    | Scrolls the page to the annotation's first highlight.                                                   |
| `selection.clear`       | —                       | Drops the selection; the guest answers `selection.changed {null}`.                                      |
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
| `scrollTo(id)`                 | `scroll.to` to the guests that were asked to anchor it                                     |
| `clearSelection()`             | `selection.clear` to the guest whose selection it is                                       |
| `onActivate(handler)`          | `highlights.activated` from any guest                                                      |

## 7. Threats considered

- **The page reads the traffic.** It can, by hooking `postMessage` before the guest loads or by reading the guest's state. The traffic holds nothing beyond selectors and IRIs; the hostile-page tests in `packages/guest/test/browser/isolation.test.ts` (fake sidebar) and `apps/sidebar/e2e/guest/hostile.spec.ts` (the real sidebar with a seeded token, a body, a tag and a creator) check that none of those appear in anything the page can observe, and that no message carries a `body`, `creator`, `tags`, `token` or `authorization` field.
- **The page impersonates the guest.** It can send its own `guest.connect` to the frame, since it is `window.parent`. It then receives what any guest receives: IRIs and selectors of annotations the sidebar's user may read on documents of the page's own origin, which the real guest would have shown as highlights there; a report of a document on another origin is refused (section 1). It cannot read bodies, act as the user or obtain a token, because the sidebar never sends those and takes no instruction from the guest beyond anchoring, scrolling and visibility.
- **A frame impersonates another frame.** A hostile frame can send `guest.discover` and gets a port, but the host records the frame's real origin on the connect, so the sidebar holds it to documents on that origin. A hostile top page can relay anything it likes to the sidebar, which is the previous case. A hostile top page can also hand a guest in a frame of ours (the embedded PDF viewer) a port to a fake sidebar: that guest then reveals the PDF's identity and what the user selects in it, which the page could not otherwise read across the origin boundary, and nothing else.
- **The page impersonates the sidebar.** The guest accepts `sidebar.ready` only from its own iframe's window at the configured origin, and port messages only on the port it created, so a page script cannot make the guest highlight or scroll on its behalf through this channel (it can through the DOM, which is outside the guest's control).
- **The page hides or covers the frame.** Out of scope for the protocol; `frame-ancestors` and visibility checks are the sidebar's defences.
- **Page-supplied configuration.** The guest reads only the sidebar origin and path from its injection; nothing in the protocol lets the page grant a login ([ADR 0007](adr/0007-guest-sidebar-split.md)).
