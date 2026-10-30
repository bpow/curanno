/**
 * The guest's PDF integration over `pdf-view.html`, where every page's text
 * layer is already rendered: a stand-in viewer whose event bus the harness
 * uses once to mark every page rendered. Describing and anchoring then go
 * through the same code as the real viewer page.
 */
import type { AnchorOptions } from '../../../src/anchoring/anchor.ts';
import { PdfIntegration } from '../../../src/integrations/pdf.ts';

type Listener = (event: { pageNumber: number }) => void;

const integrations = new Map<string, PdfIntegration>();

/** The integration for the page's viewer root with these thresholds. Undefined on HTML pages. */
export function pdfIntegration(
  root: HTMLElement,
  anchoring: AnchorOptions = {},
): PdfIntegration | undefined {
  const pdf = window.__pdf;
  if (!pdf) return undefined;
  const key = JSON.stringify(anchoring);
  let integration = integrations.get(key);
  if (integration) return integration;
  const listeners = new Set<Listener>();
  integration = new PdfIntegration({
    viewer: {
      viewer: root,
      currentPageNumber: 1,
      eventBus: {
        on: (_name, l) => void listeners.add(l),
        off: (_name, l) => void listeners.delete(l),
      },
    },
    document: pdf,
    url: location.href,
    anchoring,
  });
  integration.observe(() => undefined);
  for (let page = 1; page <= pdf.numPages; page++) {
    for (const l of listeners) l({ pageNumber: page });
  }
  integrations.set(key, integration);
  return integration;
}
