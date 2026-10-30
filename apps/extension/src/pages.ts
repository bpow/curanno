/**
 * Pure helpers for the service worker: recognizing a PDF response, the
 * viewer address for it, the public-count request and the badge text.
 */

/** The sizes the toolbar icons are drawn at (`scripts/icons.ts`). */
export const ICON_SIZES = [16, 32, 48, 128] as const;

export interface HttpHeader {
  name: string;
  value?: string | undefined;
}

function header(headers: readonly HttpHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

/** A response the browser will show as a PDF: a download is left alone. */
export function isPdfResponse(headers: readonly HttpHeader[] | undefined): boolean {
  const type = header(headers, 'content-type').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/pdf') return false;
  return !/^\s*attachment/i.test(header(headers, 'content-disposition'));
}

/** The viewer URL for a PDF, built as the bookmarklet builds it (ADR 0021). */
export function viewerUrlFor(viewerUrl: string, pdfUrl: string): string {
  const url = new URL(viewerUrl);
  url.searchParams.set('file', pdfUrl);
  return url.href;
}

export function isWebPage(url: string | undefined): url is string {
  return url !== undefined && /^https?:/i.test(url);
}

/** An anonymous search for one page that returns its total and a single item. */
export function publicCountUrl(apiOrigin: string, pageUrl: string): string {
  const url = new URL('/x/search', apiOrigin);
  url.searchParams.set('uri', pageUrl);
  url.searchParams.set('limit', '1');
  return url.href;
}

export function badgeText(count: number | undefined): string {
  if (count === undefined || count <= 0) return '';
  return count > 999 ? '999+' : String(count);
}
