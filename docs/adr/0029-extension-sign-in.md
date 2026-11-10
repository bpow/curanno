# 0029. The extension runs the sidebar's sign-in window with `chrome.identity.launchWebAuthFlow`

**Status:** Accepted

**Date:** 2026-11-10

## Context

A framed sidebar signs in through a popup on its own origin (ADR 0019). A page that sends `Cross-Origin-Opener-Policy: same-origin` breaks that. When a cross-origin frame on such a page calls `window.open`, Chromium opens the window in a new browsing context group and gives the frame `null`. The popup stays blank and `oidc-client-ts` fails with "Attempted to navigate on a disposed window". Hypothesis has the same failure, still open ([hypothesis/client#5769](https://github.com/hypothesis/client/issues/5769)).

There are no simple ways around this for the bookmarklet. Opening the provider's page directly in the popup does not help either: the result must come back to the framed sidebar, and `BroadcastChannel` and `localStorage` are partitioned by top-level site, so a first-party popup cannot reach a frame on another site. Cookies can, after `document.requestStorageAccess()` and with `SameSite=None`, but that needs a prompt per site in Safari and a cookie-based handoff that ADR 0019 avoided.

An extension has `chrome.identity.launchWebAuthFlow`: the browser opens the provider's page in a window of its own and hands the extension the URL the provider redirects to, `https://<extension id>.chromiumapp.org/…`. A page's headers cannot stop it.

Options considered:

- **Use the popup and, when `window.open` returns null, try the extension.** The extension path then runs only on some pages. Its redirect URI would go unregistered for a long time without anyone noticing. Rejected.
- **The extension does the whole flow and hands the sidebar tokens.** It would hold the PKCE verifier and the tokens, contrary to ADR 0023. Rejected.
- **The sidebar runs the flow and the extension only opens the window.** Chosen.

## Decision

- When the extension is on in a tab, the service worker injects a small **bridge** content script into the sidebar's frame, matched by the sidebar URL in the extension's settings, in place of the guest. The bridge and the sidebar talk over the sidebar window's own `postMessage`. Each side accepts a message only when `event.source` is that window and `event.origin` its origin. The host page and other frames can post to the sidebar window but never as it, and cannot listen on it. The messages are in `@curanno/model` (`extension-bridge`).
- The bridge announces itself with the extension's redirect URI, `https://<id>.chromiumapp.org/`, on start and when the sidebar asks. A sidebar that has heard it signs in and out through the extension, on every page, not only where the popup fails.
- The sidebar builds the request as before: Authorization Code with PKCE, `redirect_uri` set to the extension's URI, and the verifier kept in its own `localStorage`. It posts the authorization URL to the bridge. The bridge passes it to the service worker, which accepts it only from a frame whose URL (as the browser reports it) is the sidebar's, and runs `launchWebAuthFlow`. The worker returns the URL the flow ended on only if it starts with `chrome.identity.getRedirectURL()`. The sidebar exchanges the code itself. Sign-out sends the end-session URL the same way, with the same URI as `post_logout_redirect_uri`, and the sidebar always forgets its tokens afterwards.
- In `oidc-client-ts` this is a second `UserManager` built with the extension's redirect URI and a navigator that posts to the bridge instead of opening a popup. It shares the main manager's stores, so the main manager loads the tokens it obtained and keeps renewing them. Refresh needs no redirect URI.
- The extension's id is fixed by a public `key` in its manifest, `dmlkjhnoiinndnkboiknehimngilddpp`, so one redirect URI can be registered for every unpacked install. The private key is not in the repository; it is needed only to pack a `.crx` with that id.
- Providers register the redirect URI as both a redirect and a post-logout redirect URI. The embedded issuer adds it for each id in `AUTH_EXTENSION_IDS`, and lists it in its sign-out page's `form-action`, because Chromium applies that directive to the redirect after the form is posted. `deploy/zitadel/provision.ts --extension-id` registers it with Zitadel. The chart's `extensionIds` feeds both.
- Without the extension, a popup that the page cut off now produces a message that says so and points at the extension, instead of the library's error.

## Consequences

- With the extension on, sign-in works on pages with any opener policy. The bookmarklet still fails on them. Storage access with a cookie handoff, or a hosted proxy that strips the header, would be separate decisions.
- The extension needs the `identity` permission, which shows no install warning. It still holds no token and no verifier. The authorization code and the end of the redirect pass through the bridge and the worker on their way to the sidebar, which alone can redeem the code.
- A deployment must register the extension's redirect URI. Until it does, sign-in through the extension stops at the provider's error page about the redirect URI, on every page. That makes the gap visible, which is why the extension is always used when present.
- Silent sign-in at startup still uses the hidden iframe and fails where third-party cookies are blocked. A non-interactive `launchWebAuthFlow` with `prompt=none` could replace it in the extension; not done.
- A build published to the Chrome Web Store gets the store's id unless the store listing keeps this key. A different id is another redirect URI to register.
- The extension's window uses the browser profile's cookies, so the provider's session is first-party there, as it is in the popup.

## References

- ADR 0019, ADR 0023, ADR 0028
- [hypothesis/client#5769](https://github.com/hypothesis/client/issues/5769)
- [`chrome.identity.launchWebAuthFlow`](https://developer.chrome.com/docs/extensions/reference/api/identity#method-launchWebAuthFlow)
- [Cross-Origin-Opener-Policy](https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies)
