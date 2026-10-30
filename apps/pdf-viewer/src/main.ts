/**
 * The PDF viewer page: PDF.js's `PDFViewer` component rendering pages as
 * they near the viewport, with the guest running over it through the PDF
 * integration (ADR 0021). The page is ours, so the guest is built in rather
 * than injected; the PDF is the untrusted input, and PDF.js renders it with
 * scripting and XFA forms off (PDF.js 6 has no eval path left to disable).
 */
import { Guest, PdfIntegration, pdfUrn } from '@scale/guest';
import * as pdfjs from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { loadConfig } from './config.js';
import { fileUrlFrom, nameOf, type PdfSource } from './source.js';
import './style.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const TEXT_LAYER_ENABLE = 1;
const ANNOTATION_LAYER_ENABLE = 1;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const container = element<HTMLDivElement>('viewerContainer');
const openPanel = element<HTMLElement>('open');
const openError = element<HTMLParagraphElement>('open-error');
const title = element<HTMLSpanElement>('title');
const pageInput = element<HTMLInputElement>('page');
const pageCount = element<HTMLSpanElement>('page-count');
const zoomSelect = element<HTMLSelectElement>('zoom');

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const viewer = new PDFViewer({
  container,
  eventBus,
  linkService,
  textLayerMode: TEXT_LAYER_ENABLE,
  annotationMode: ANNOTATION_LAYER_ENABLE,
});
linkService.setViewer(viewer);

let guest: Guest | undefined;

function showError(message: string): void {
  openError.textContent = message;
  openError.hidden = false;
  openPanel.hidden = false;
}

async function open(source: PdfSource): Promise<void> {
  const config = await loadConfig();
  const loading = pdfjs.getDocument({
    ...(source.kind === 'url' ? { url: source.url } : { data: source.data }),
    enableXfa: false,
  });
  const pdf = await loading.promise;
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  const name = source.kind === 'url' ? nameOf(source.url) : source.name;
  const url = source.kind === 'url' ? source.url : pdfUrn(pdf.fingerprints[0] ?? name);
  const info = (await pdf.getMetadata().catch(() => undefined))?.info as
    { Title?: unknown } | undefined;
  const displayTitle = typeof info?.Title === 'string' && info.Title.trim() ? info.Title : name;
  document.title = displayTitle;
  title.textContent = displayTitle;
  title.title = url;
  pageCount.textContent = String(pdf.numPages);
  pageInput.max = String(pdf.numPages);
  openPanel.hidden = true;

  guest?.destroy();
  guest = new Guest({
    sidebarOrigin: config.sidebarOrigin,
    sidebarPath: config.sidebarPath,
    integration: new PdfIntegration({
      viewer,
      document: pdf,
      url,
      ...(source.kind === 'file' ? { title: name } : {}),
    }),
  });
  guest.start();
}

// Toolbar
eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
  pageInput.value = String(pageNumber);
});
eventBus.on('pagesinit', () => {
  viewer.currentScaleValue = 'auto';
});
eventBus.on('scalechanging', ({ presetValue, scale }: { presetValue?: string; scale: number }) => {
  const value = presetValue ?? String(scale);
  if ([...zoomSelect.options].some((o) => o.value === value)) zoomSelect.value = value;
});
pageInput.addEventListener('change', () => {
  const page = Number(pageInput.value);
  if (Number.isInteger(page) && page >= 1 && page <= viewer.pagesCount) {
    viewer.currentPageNumber = page;
  }
});
zoomSelect.addEventListener('change', () => {
  viewer.currentScaleValue = zoomSelect.value;
});
element('zoom-in').addEventListener('click', () => viewer.increaseScale());
element('zoom-out').addEventListener('click', () => viewer.decreaseScale());
element('toggle-sidebar').addEventListener('click', () => guest?.toggleSidebar());

// Make room for the sidebar frame while it is shown.
new MutationObserver(() => {
  const frame = document.querySelector<HTMLElement>('[data-scale-guest="sidebar"]');
  const open = frame !== null && !frame.hidden;
  document.documentElement.style.setProperty('--sidebar-width', open ? 'min(420px, 100vw)' : '0px');
}).observe(document.body, { childList: true, attributes: true, attributeFilter: ['hidden'] });

// The open panel
element<HTMLFormElement>('open-url').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = element<HTMLInputElement>('url').value.trim();
  const url = fileUrlFrom(`?file=${encodeURIComponent(value)}`);
  if (!url) {
    showError('Enter an absolute http or https URL.');
    return;
  }
  const next = new URL(window.location.href);
  next.searchParams.set('file', url);
  window.location.assign(next.href);
});
element<HTMLInputElement>('file').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void file
    .arrayBuffer()
    .then((data) => open({ kind: 'file', name: file.name, data }))
    .catch((err: unknown) => showError(describe(err)));
});

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const fileUrl = fileUrlFrom(window.location.search);
if (fileUrl) {
  element<HTMLInputElement>('url').value = fileUrl;
  open({ kind: 'url', url: fileUrl }).catch((err: unknown) => {
    showError(
      `The PDF could not be loaded: ${describe(err)}. The server must allow cross-origin reads (CORS); otherwise download the file and open it from your computer.`,
    );
  });
} else {
  openPanel.hidden = false;
}
