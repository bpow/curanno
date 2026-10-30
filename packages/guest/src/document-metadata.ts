/**
 * What the page says about its own identity (docs/document-identity.md,
 * section 4), collected exactly as found and turned into the links the
 * sidebar registers, through the model's derivation (ADR 0014).
 */
import { deriveDocumentUris, type GuestDocument, type PageMetadata } from '@scale/model';

/** Content of the first `meta` whose `name` or `property` equals `key`, case-insensitively. */
function metas(doc: Document, key: string): string[] {
  const wanted = key.toLowerCase();
  return Array.from(doc.querySelectorAll<HTMLMetaElement>('meta[name], meta[property]'))
    .filter(
      (m) =>
        m.getAttribute('name')?.toLowerCase() === wanted ||
        m.getAttribute('property')?.toLowerCase() === wanted,
    )
    .map((m) => m.getAttribute('content')?.trim() ?? '')
    .filter(Boolean);
}

function meta(doc: Document, key: string): string | undefined {
  return metas(doc, key)[0];
}

/** `href` of the first `link` whose `rel` tokens include `rel`, case-insensitively. */
function link(doc: Document, rel: string): string | undefined {
  const element = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel][href]')).find((l) =>
    (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes(rel),
  );
  return element?.getAttribute('href')?.trim() || undefined;
}

export function collectPageMetadata(doc: Document): PageMetadata {
  const page: PageMetadata = { url: doc.location.href };
  const title = doc.title.trim();
  if (title) page.title = title;
  const canonical = link(doc, 'canonical');
  if (canonical) page.canonical = canonical;
  const shortlink = link(doc, 'shortlink');
  if (shortlink) page.shortlink = shortlink;
  const ogUrl = meta(doc, 'og:url');
  if (ogUrl) page.ogUrl = ogUrl;
  const dcIdentifiers = metas(doc, 'dc.identifier');
  if (dcIdentifiers.length > 0) page.dcIdentifiers = dcIdentifiers;
  const isPartOf = meta(doc, 'dc.relation.ispartof');
  if (isPartOf) page.dcRelationIsPartOf = isPartOf;
  const doi = meta(doc, 'citation_doi');
  if (doi) page.doi = doi;
  const pdfUrl = meta(doc, 'citation_pdf_url');
  if (pdfUrl) page.pdfUrl = pdfUrl;
  return page;
}

export function collectDocument(doc: Document): GuestDocument {
  const page = collectPageMetadata(doc);
  const result: GuestDocument = {
    uri: page.url,
    links: deriveDocumentUris(page).map(({ uri, relation }) => ({ uri, relation })),
  };
  if (page.title) result.title = page.title;
  return result;
}
