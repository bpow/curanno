# 0023. A Manifest V3 extension runs the guest as a content script in every frame

**Status:** Accepted

**Date:** 2026-10-30

## Context

The bookmarklet (ADR 0007) adds a script element that loads the guest bundle from the deployment, and the guest then frames the sidebar. Both steps can be stopped by the page: a `script-src` policy blocks the bundle, a `frame-src` policy blocks the sidebar, and Chromium runs no bookmarklet at all in its built-in PDF viewer (ADR 0021). Cross-origin frames get a guest only when their page loads one itself. The plan deferred browser extension packaging past 1.0; this records how it is built.

## Decision

- The extension is `apps/extension`, a Manifest V3 extension for Chromium browsers. Its content script is built from the guest's source, so the code that runs in the page ships inside the extension and nothing is fetched from the deployment.
- The guest runs in the extension's **isolated world**, not the page's. The page shares the DOM with it but not its JavaScript objects, so the page cannot reach the guest's global or patch what it calls. What the guest sends the sidebar is unchanged (ADR 0007): selectors and the document report, never tokens or bodies.
- The toolbar button turns the guest on or off **per tab**. While it is on, the service worker injects the content script into every frame that finishes loading in that tab, cross-origin frames included, and the frames connect through the host as in the RPC protocol's section 3. The host's own same-origin frame injection is not used: it injects a script element into the page's world.
- Frames from the sidebar's or the PDF viewer's origin, and frames nested inside them such as the identity provider's, never get the content script. The sidebar must not host a guest, and the viewer builds its own in.
- Iframes that a content script inserts are not subject to the page's `frame-src`, so the sidebar loads on pages that block the bookmarklet's. It still has to be allowed by the sidebar's `frame-ancestors` (ADR 0007), so a deployment that serves extension users on arbitrary sites lists `https:` there.
- A main-frame response with `Content-Type: application/pdf` in a tab where the guest is on, or the button pressed on such a tab, sends the tab to the PDF viewer with the PDF's URL.
- The badge shows the number of annotations the sidebar asked the tab's guests to anchor, which is what the viewer can read. The guest hands the content script that count and nothing else. While the guest is off, the badge can show the number of public annotations on the page from an anonymous `GET /x/search`. That sends every page address to the deployment, so it is off until the user turns it on in the options page.
- The options page holds the sidebar URL, the API URL, the PDF viewer URL and the public-count switch, in `chrome.storage.sync`. The extension holds no token: sign-in stays in the sidebar origin (ADR 0019).

## Consequences

- The extension needs host permission for all sites, plus `scripting`, `storage`, `webNavigation` and `webRequest` (read-only, to see a response's content type). Store reviewers and users see the broad host permission.
- Page CSP no longer decides whether annotation works, apart from the sidebar's own `frame-ancestors`.
- An extension release ships its own copy of the guest. A deployment that changes the RPC protocol incompatibly needs a new extension release as well as new sidebar and bookmarklet builds; additive changes, as the protocol requires, do not.
- `about:blank` and `srcdoc` frames, which have no URL to match, get no guest.
- Firefox and Safari are not targets for now. MV3 differences (the `browser` namespace, background scripts in Firefox) would be handled when one is.

## References

- ADR 0007, ADR 0019, ADR 0021
- [Guest/sidebar RPC protocol, section 3](../guest-sidebar-rpc.md)
- [apps/extension/README.md](../../apps/extension/README.md)
