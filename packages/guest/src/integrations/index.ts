export {
  HtmlIntegration,
  anchorInScope,
  isGuestOwned,
  type HtmlIntegrationOptions,
} from './html.js';
export {
  PDF_FRAGMENT_CONFORMS_TO,
  PdfIntegration,
  pageFragmentSelector,
  pageOfFragment,
  pdfUrn,
  type PdfDocumentLike,
  type PdfEventBusLike,
  type PdfIntegrationOptions,
  type PdfPageLike,
  type PdfViewerLike,
} from './pdf.js';
export { pageTextScope, pageTextTree, type PdfTextItem, type VirtualNode } from './pdf-text.js';
export { describeSelection, trimTextRange } from './selection.js';
export type {
  AnchoredTarget,
  AnchoredTargetSelectors,
  DescribedSelection,
  DocumentIntegration,
} from './types.js';
