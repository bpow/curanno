/**
 * Renders every page of a PDF as a PDF.js text layer (no canvas) so the
 * candidates can anchor against the same DOM a PDF.js viewer would give
 * them. The runner waits for `data-trial-ready` on the root element.
 */
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = '/__trial/pdfjs/pdf.worker.mjs';

async function render() {
  const file = new URLSearchParams(location.search).get('file');
  if (!file) throw new Error('missing ?file=');
  const viewer = document.getElementById('viewer')!;
  const pdf = await pdfjs.getDocument({ url: file }).promise;
  window.__pdf = pdf as unknown as Window['__pdf'];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.25 });
    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    pageDiv.dataset['pageNumber'] = String(i);
    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;
    pageDiv.style.setProperty('--scale-factor', String(viewport.scale));
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    pageDiv.appendChild(layer);
    viewer.appendChild(pageDiv);
    const textLayer = new pdfjs.TextLayer({
      textContentSource: await page.getTextContent(),
      container: layer,
      viewport,
    });
    await textLayer.render();
  }
  document.documentElement.dataset['trialReady'] = '';
}

document.documentElement.dataset['trialWait'] = '';
render().catch((err: unknown) => {
  document.documentElement.dataset['trialError'] = String(err);
});
