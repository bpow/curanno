import {
  canonicalizeDoi,
  canonicalizeUri,
  dcIdentifierUri,
  pdfFingerprintUri,
} from './canonicalize.js';

/** How a URI came to identify a document. Stored in `document_uris.relation`. */
export const DOCUMENT_URI_RELATIONS = [
  'self',
  'canonical',
  'shortlink',
  'alternate',
  'og_url',
  'dc_identifier',
  'doi',
  'pdf_fingerprint',
  'pdf_url',
] as const;

export type DocumentUriRelation = (typeof DOCUMENT_URI_RELATIONS)[number];

/** What a client reports about the page it is annotating. */
export interface PageMetadata {
  /** The page's own URL (`location.href`), or the PDF's URL. */
  url: string;
  title?: string;
  /** `<link rel="canonical">` */
  canonical?: string;
  /** `<link rel="shortlink">` */
  shortlink?: string;
  /** `<meta property="og:url">` */
  ogUrl?: string;
  /** `<meta name="dc.identifier">`, every occurrence */
  dcIdentifiers?: string[];
  /** `<meta name="dc.relation.ispartof">` */
  dcRelationIsPartOf?: string;
  /** `<meta name="citation_doi">` (Highwire), or any DOI the client found */
  doi?: string;
  /** `<meta name="citation_pdf_url">` */
  pdfUrl?: string;
  /** PDF.js fingerprint of a PDF document */
  pdfFingerprint?: string;
}

export interface DocumentUri {
  /** The URI as reported. */
  uri: string;
  /** The canonical lookup form. */
  normalized: string;
  relation: DocumentUriRelation;
}

/** Relations in order of trust; the first wins when two produce the same normalized URI. */
const PRECEDENCE: DocumentUriRelation[] = [
  'self',
  'pdf_fingerprint',
  'canonical',
  'doi',
  'dc_identifier',
  'og_url',
  'shortlink',
  'pdf_url',
];

/**
 * The set of URIs that identify the document a page describes, with the
 * guards from docs/document-identity.md applied: links resolve against the
 * page URL, must be http(s), and a link to a site's root is ignored because
 * it almost always comes from a misconfigured template.
 */
export function deriveDocumentUris(page: PageMetadata): DocumentUri[] {
  const candidates: DocumentUri[] = [];
  const add = (
    uri: string | undefined,
    relation: DocumentUriRelation,
    normalized: string | null,
  ): void => {
    if (!uri || !normalized) return;
    candidates.push({ uri, normalized, relation });
  };

  const self = canonicalizeUri(page.url);
  add(page.url, 'self', self);
  if (page.pdfFingerprint) {
    const uri = pdfFingerprintUri(page.pdfFingerprint);
    add(uri, 'pdf_fingerprint', uri);
  }
  add(page.canonical, 'canonical', resolveLink(page.canonical, page.url));
  add(page.doi, 'doi', page.doi ? canonicalizeDoi(page.doi) : null);
  for (const id of page.dcIdentifiers ?? []) {
    add(id, 'dc_identifier', dcIdentifierUri(id, page.dcRelationIsPartOf));
  }
  add(page.ogUrl, 'og_url', resolveLink(page.ogUrl, page.url));
  add(page.shortlink, 'shortlink', resolveLink(page.shortlink, page.url));
  add(page.pdfUrl, 'pdf_url', resolveLink(page.pdfUrl, page.url));

  return rankDocumentUris(candidates);
}

/** Orders URIs by trust and keeps the most trusted of those sharing a normalized form. */
export function rankDocumentUris(candidates: DocumentUri[]): DocumentUri[] {
  const ranked = [...candidates].sort(
    (a, b) => PRECEDENCE.indexOf(a.relation) - PRECEDENCE.indexOf(b.relation),
  );
  const seen = new Set<string>();
  return ranked.filter((c) => {
    if (seen.has(c.normalized)) return false;
    seen.add(c.normalized);
    return true;
  });
}

/** Resolve a link against the page URL and canonicalize it, applying the root guard. */
export function resolveLink(link: string | undefined, base: string): string | null {
  if (!link || link.trim() === '') return null;
  let absolute: string;
  try {
    absolute = new URL(link.trim(), base).href;
  } catch {
    return null;
  }
  const normalized = canonicalizeUri(absolute);
  if (!normalized || !normalized.startsWith('https://')) return null;
  if (isSiteRoot(normalized)) return null;
  return normalized;
}

function isSiteRoot(normalized: string): boolean {
  const url = new URL(normalized);
  return url.pathname === '/' && url.search === '';
}
