# 0007. Guest/sidebar client split with the sidebar on our own origin

**Status:** Accepted

**Date:** 2026-10-29

## Context

The client annotates pages we do not control. Any script on such a page can read and modify the page's DOM and storage. Requirement 5 asks that login sessions, tokens and the annotation UI stay out of that page's reach. Hypothesis addresses this by splitting its client into a small guest script in the page and a sidebar application in an iframe on its own origin, with the two communicating over typed messages. Annotator and Recogito keep state and UI in the host page and do not provide this protection.

## Decision

The client follows the same split:

- A **guest** script is injected into each frame of the annotated page. It handles selection, anchoring and highlights, and nothing else.
- A **sidebar** application runs in an iframe served from our own origin. It holds the login session, makes all API calls and renders all annotation content.
- The two communicate over a postMessage RPC protocol with message types defined in `packages/model`.
- The guest receives only selectors and annotation identifiers. Bodies, tags and authors never enter the host page.

## Consequences

- Credentials and annotation content are protected from host-page scripts, and one sidebar can serve several frames, including PDF.js viewers.
- The guest remains exposed: the page can read or alter selections and highlights, and selectors include quoted text. The split limits what that code can reach, not the code itself.
- The protection depends on the sidebar truly being on a different origin from any page it is used on. Serving the sidebar from a customer's own domain would weaken it.
- The page can hide, cover or remove the sidebar frame, so clickjacking defenses (frame-ancestors policy, visibility checks) are required.
- Page-supplied configuration must never grant a login or a token, since that makes the page part of the trust relationship.
- The RPC layer is ours to design, version and test; nothing from the reviewed projects is reusable for it directly.

## References

- [Analysis note: The architectural lesson from Hypothesis](../web-annotation-replacement.md#the-architectural-lesson-from-hypothesis)
- [Hypothesis client security overview](https://h.readthedocs.io/projects/client/en/latest/developers/security.html)
