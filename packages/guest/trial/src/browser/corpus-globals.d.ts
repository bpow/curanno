/** Hooks that the corpus's framework pages (react-rerender, vue-rerender) expose for the trial scripts. */
interface Window {
  __app: { render: (version: number, keyPrefix?: string) => void; rerender: () => void };
  /** The loaded PDF.js document on `pdf-view.html`, for the guest's PDF integration. */
  __pdf?: import('../../../src/integrations/pdf.ts').PdfDocumentLike;
}
