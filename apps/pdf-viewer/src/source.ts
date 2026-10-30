/**
 * What the viewer shows: a PDF named by the `file` query parameter, which
 * must be an absolute http(s) URL (the viewer fetches it, so the host must
 * allow cross-origin reads), or a file the user picks, which has no URL and
 * is identified by its fingerprint alone (docs/document-identity.md,
 * section 7).
 */
export type PdfSource =
  { kind: 'url'; url: string } | { kind: 'file'; name: string; data: ArrayBuffer };

/** The URL in a viewer location's `file` parameter, or undefined when there is none that is usable. */
export function fileUrlFrom(search: string): string | undefined {
  const raw = new URLSearchParams(search).get('file');
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  url.hash = '';
  return url.href;
}

/** The viewer URL for a PDF at `pdfUrl`, as the bookmarklet and links build it. */
export function viewerUrlFor(viewerBase: string, pdfUrl: string): string {
  const url = new URL(viewerBase);
  url.searchParams.set('file', pdfUrl);
  return url.href;
}

/** A display name for a PDF: its URL's last path segment, or the URL itself. */
export function nameOf(url: string): string {
  try {
    const segment = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return segment || url;
  } catch {
    return url;
  }
}
