# PDF viewer

The page that shows a PDF so that it can be annotated ([ADR 0021](../../docs/adr/0021-pdf-viewer-and-client-serving.md)): PDF.js's `PDFViewer` component rendering pages as they near the viewport, with the guest built in through its PDF integration (`packages/guest/src/integrations/pdf.ts`). The sidebar opens in the same frame as on any page and sees the PDF's URL and fingerprint as the document, never the viewer's own location.

## Running it

```bash
pnpm --filter @curanno/pdf-viewer dev
```

serves the viewer at <http://localhost:5174/pdf/>; open `?file=<absolute URL of a PDF>` or use the form to pick a file. The sidebar comes from `public/config.json` (`http://localhost:3001/sidebar/` by default, where `just dev` serves it). A deployment serves the viewer from the API image on its own host name and generates `config.json` from the API's environment.

The file's host must allow cross-origin reads (the viewer fetches the PDF from the browser). Where it does not, download the file and open it from your computer: the annotations follow the file's fingerprint ([document identity, section 7](../../docs/document-identity.md)).

## What the guest does here

- Each annotation target is a `FragmentSelector` naming the page (`page=N`), refined by the text selectors scoped to that page's text layer ([text model, section 11](../../docs/text-model.md)).
- A page that is not rendered yet is anchored in the text PDF.js would render, built from the document's text content, so the sidebar shows the right state at once; the highlight appears when the page renders. When PDF.js unloads a page far from view the result is kept and only its highlights go.
- Text that moved to another page in a revised file is found on the other pages, nearest first; several matches are reported as ambiguous rather than guessed (ADR 0010).

PDF.js renders with forms and XFA off. The viewer takes nothing from its URL but the PDF's address; where the sidebar is comes from `config.json` only (ADR 0007).

## Tests

`pnpm test` runs the unit tests of the URL handling; the PDF integration's tests are in the guest package (`packages/guest/src/integrations/pdf.test.ts`); the bookmarklet suite's `pdf.spec.ts` (`pnpm --filter @curanno/sidebar e2e:guest`) drives the built viewer on its preview server with the built sidebar and a stubbed API.
