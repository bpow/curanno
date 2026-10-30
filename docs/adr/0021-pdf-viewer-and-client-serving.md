# 0021. The PDF viewer is a static app on its own origin, and the API image serves every client

**Status:** Accepted

**Date:** 2026-10-30

## Context

Annotating a PDF needs a viewer whose text layer the guest can anchor in (plan, Phase 5; text model, section 11). Browsers' built-in PDF viewers run no page scripts, so the bookmarklet cannot work there; the viewer has to be ours, built on PDF.js. Two questions followed: on which origin the viewer page is served, and how the viewer, the sidebar, the guest bundle and the management site reach a deployment at all, since until now only the API had an image and the chart carried only the API.

ADR 0019 puts the sidebar and the API on one origin and keeps tokens in the sidebar origin's `sessionStorage`. A page on that same origin shares that storage with the sidebar frame it embeds. The viewer page is our code, but what it renders is not: PDF.js parses attacker-supplied files, and a rendering bug that reached script would run on the viewer's origin. If that origin were the sidebar's, the token would be one `sessionStorage` read away, and the guest/sidebar split (ADR 0007) would protect nothing on PDFs.

Configuration baked into static builds (`VITE_*` variables) would mean one image per deployment, against the plan's rule that configuration is environment only (plan, section 9).

## Decision

- The viewer is a small static app, `apps/pdf-viewer`, built with Vite like the sidebar: PDF.js's `PDFViewer` component with the text layer on, forms and XFA off, and the guest built in through its PDF integration (`packages/guest/src/integrations/pdf.ts`). It takes the PDF's URL in its `file` query parameter (absolute `http(s)` only) or a file the user picks; a picked file is identified by its fingerprint alone. The viewer fetches the PDF itself, so the file's host must allow cross-origin reads; a fetching proxy is not part of this decision.
- In production the viewer is served on **an origin of its own** (`pdfViewer.host` in the chart, for example `pdf.annotations.example`), listed in the sidebar's `frame-ancestors`. The API serves the viewer's files only for that host when it is configured, so the viewer cannot be opened on the sidebar's origin. The sidebar treats a document report from the viewer origin as it treats the page's own: the viewer reports the PDF's URL and fingerprint, not its own location.
- The **API image serves the clients**: the sidebar under `/sidebar/`, the viewer under `/pdf/`, the guest bundle at `/guest.js`, each with its `Content-Security-Policy` (`frame-ancestors` for the sidebar from the chart's list), and `config.json` under each app generated from the API's environment. The sidebar and the viewer read `config.json` at start, so one image runs everywhere. The management site runs as its own container from the same repository build (Nuxt's server renders the landing page and serves the rest; runtime configuration through `NUXT_PUBLIC_*`), behind the same ingress host as the API, with `/annotations`, `/x`, `/sidebar`, `/pdf` and `/guest.js` routed to the API.
- Development keeps the deployed paths: the sidebar dev server is at `/sidebar/`, the viewer at `/pdf/` on another port, so what works locally works deployed.

## Consequences

- A PDF.js vulnerability triggered by a malicious file lands on an origin that holds no token and no annotation content; the sidebar frame inside the viewer stays as isolated as on any third-party page.
- Two host names to issue certificates for, and the viewer host must be in `frame-ancestors`; the chart does both from one value.
- PDFs on hosts without CORS cannot be opened by URL. Users download the file and open it from their computer, and the fingerprint still finds the same document; the user guide says so. A proxy would be a new decision with its own threat model.
- The API process serves static files and sets headers; there is no separate web server image to run. The management site is a second container because its runtime configuration needs a server, which also keeps ADR 0020's split intact.
- The bookmarklet redirects a browser tab showing a PDF to the viewer where the browser lets it run; where it does not (Chromium's built-in viewer), users paste the URL into the viewer.

## References

- ADR 0007, ADR 0017, ADR 0019, ADR 0020
- [Text model, section 11](../text-model.md); [document identity, section 7](../document-identity.md)
- [apps/pdf-viewer/README.md](../../apps/pdf-viewer/README.md); [operator guide](../operator-guide.md)
