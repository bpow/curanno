# Guest/sidebar RPC protocol

**Protocol `scale-annotation/guest-sidebar`, version 1.** How the in-page guest and the sidebar iframe talk ([ADR 0007](adr/0007-guest-sidebar-split.md)). The message types are in `packages/model/src/rpc/`, which both sides compile against; the guest side is implemented in `packages/guest/src/rpc/`, with an in-memory fake sidebar for tests and development, and the sidebar side in `apps/sidebar/src/guest/rpc.ts`. Hypothesis's `frame-sync` was the reference design; nothing was copied from it.

## 1. Principles

- **The page is untrusted.** Any script on the annotated page can read and alter what the guest does. The protocol therefore never carries anything that would hurt if the page read it: no bodies, tags, creators or tokens, in either direction. The guest sees annotation IRIs and selectors; selectors include the quoted text, which the page can see anyway.
- **One port per guest.** After discovery over `window.postMessage`, each guest talks to the sidebar over its own `MessageChannel` port. A page script that was present before the guest loaded can still hook `MessagePort.prototype.postMessage`; the first principle is what protects against that, not the port.
- **Strict origin checks on the guest.** The guest knows the sidebar's origin (from the bookmarklet configuration) and accepts window messages only from that origin and only from its own iframe's window. The sidebar cannot know the page's origin in advance; it accepts `guest.connect` only from `window.parent` and learns the guest's origin from that message.
- **Events, not requests.** Every message is a notification; nothing waits for a reply. Ordering within one port is guaranteed by `MessageChannel`, and each side's state is replaceable (`annotations.anchor` replaces results for the same IRIs; `document.report` and `selection.changed` carry whole values), so a lost or duplicated message is harmless.
- **Versioned.** Every message carries `protocol` and `version`. A peer that receives an unknown version answers `guest.error` or `sidebar.error` and ignores the rest. Additive optional fields do not bump the version.

## 2. Envelope

Every message is a JSON object with:

| Field      | Value                                   |
| ---------- | --------------------------------------- |
| `protocol` | `"scale-annotation/guest-sidebar"`       |
| `version`  | `1`                                     |
| `type`     | one of the types below                  |

`envelope(payload)` in `@scale/model` adds the first two; `parseWindowMessage`, `parseSidebarMessage` and `parseGuestMessage` check a received value and return it typed, or `undefined` for anything that is not a well-formed message of the expected direction.

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

The sidebar may send `sidebar.ready` again (after a reload, say); the guest then discards the old port, connects a new one and repeats `guest.hello` and `document.report`. The guest sends nothing over a port before `sidebar.hello` arrives on it, except `guest.hello`. Conversely a second `guest.connect` (a reloaded guest, or a page script posing as one) replaces the sidebar's port: it forgets the old guest's results and, after the new `guest.hello`, sends `annotations.anchor` again for every annotation it has asked to anchor and not withdrawn, so the new guest draws what the old one did. The sidebar holds one connection at a time; several guests per sidebar are Phase 5.

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

| Type            | Direction        | Fields    | Notes                                                                 |
| --------------- | ---------------- | --------- | --------------------------------------------------------------------- |
| `sidebar.ready` | sidebar → parent | —         | Sent with target origin `*`; carries nothing a page could use.        |
| `guest.connect` | guest → sidebar  | `guestId` | Sent with the sidebar origin as target; transfers one `MessagePort`.  |

### Guest → sidebar (over the port)

| Type                   | Fields                   | Notes                                                                                                        |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `guest.hello`          | `guestId`, `capabilities` | First message on a port. `capabilities.highlights` is `css-highlight` or `overlay`.                          |
| `document.report`      | `document`               | `{uri, title?, links}`; `links` are `{uri, relation}` exactly as found, from `deriveDocumentUris`.           |
| `anchoring.results`    | `results`                | One `AnchoringResult` per annotation: `id`, overall `state`, and one `TargetAnchoringResult` per target.     |
| `selection.changed`    | `selection` or `null`    | `{target, quote}`; `target` is a `SpecificResource` with the page URL as `source` and the three selectors.   |
| `highlights.hovered`   | `ids`                    | Annotations under the pointer; `[]` when it leaves them.                                                     |
| `highlights.activated` | `ids`                    | Annotations under a click.                                                                                   |
| `sidebar.visibility`   | `open`                   | After any open, close or toggle, whoever asked.                                                              |
| `guest.error`          | `message`, `inReplyTo?`  | A sidebar message could not be handled, or the version is unknown.                                           |

`AnchoringResult.state` is `anchored` when any target anchored, otherwise `ambiguous` when any target was, otherwise `orphaned` ([ADR 0010](adr/0010-keep-original-selectors.md)). A target without text selectors (the whole page) anchors with no `range`. Per-target results carry the code point `range` ([ADR 0012](adr/0012-code-point-offsets.md)), how it was found (`via`: `range`, `position` or `quote`) and the quote match `score`, or the `candidates` of an ambiguous match, or the `reason` for an orphan.

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

The sidebar's `Guest` interface (`apps/sidebar/src/guest/types.ts`) is a thin view of this protocol:

| Sidebar interface            | Protocol                                                   |
| ---------------------------- | ---------------------------------------------------------- |
| `document`                   | the last `document.report`                                 |
| `selection`                  | the last `selection.changed`                               |
| `anchoring` (IRI → state)    | `anchoring.results`, merged by `id`                        |
| `hovered`                    | the last `highlights.hovered`                              |
| `anchor(requests)`           | `annotations.anchor`                                       |
| `unanchor(ids)`              | `annotations.unanchor`                                     |
| `focus(ids)`                 | `highlights.focus`                                         |
| `scrollTo(id)`               | `scroll.to`                                                |
| `clearSelection()`           | `selection.clear`                                          |
| `onActivate(handler)`        | `highlights.activated`                                     |

## 7. Threats considered

- **The page reads the traffic.** It can, by hooking `postMessage` before the guest loads or by reading the guest's state. The traffic holds nothing beyond selectors and IRIs; the hostile-page tests in `packages/guest/test/browser/isolation.test.ts` (fake sidebar) and `apps/sidebar/e2e/guest/hostile.spec.ts` (the real sidebar with a seeded token, a body, a tag and a creator) check that none of those appear in anything the page can observe, and that no message carries a `body`, `creator`, `tags`, `token` or `authorization` field.
- **The page impersonates the guest.** It can send its own `guest.connect` to the frame, since it is `window.parent`. It then receives what any guest receives: IRIs and selectors of annotations the sidebar's user may read, which the real guest would have shown as highlights on that same page. It cannot read bodies, act as the user or obtain a token, because the sidebar never sends those and takes no instruction from the guest beyond anchoring, scrolling and visibility.
- **The page impersonates the sidebar.** The guest accepts `sidebar.ready` only from its own iframe's window at the configured origin, and port messages only on the port it created, so a page script cannot make the guest highlight or scroll on its behalf through this channel (it can through the DOM, which is outside the guest's control).
- **The page hides or covers the frame.** Out of scope for the protocol; `frame-ancestors` and visibility checks are the sidebar's defences.
- **Page-supplied configuration.** The guest reads only the sidebar origin and path from its injection; nothing in the protocol lets the page grant a login ([ADR 0007](adr/0007-guest-sidebar-split.md)).
