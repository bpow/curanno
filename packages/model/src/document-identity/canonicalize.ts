/**
 * URL canonicalization for document identity (docs/document-identity.md,
 * ADR 0014). The canonical form is a lookup key, never shown to users and
 * never used to fetch anything; the URI as the page reported it is stored
 * beside it.
 */

/** Query parameters that track visits rather than identify content. */
export const TRACKING_PARAMETERS: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
]);

const UNRESERVED = /%(4[1-9A-F]|5[0-9A]|6[1-9A-F]|7[0-9A]|3[0-9]|2[DE]|5F|7E)/gi;

/**
 * Canonical form of a URI, or null when it cannot identify a document
 * (unparseable, or a scheme we do not identify documents by).
 */
export function canonicalizeUri(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) return null;
  switch (scheme) {
    case 'http':
    case 'https':
      return canonicalizeHttp(trimmed);
    case 'doi':
      return canonicalizeDoi(trimmed.slice(4));
    case 'urn':
      return canonicalizeUrn(trimmed);
    default:
      return null;
  }
}

function canonicalizeHttp(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname === '') return null;
  // http and https are the same document: sites move between them and
  // serve the same content on both. The original scheme is kept in `uri`.
  url.protocol = 'https:';
  url.hash = '';
  url.username = '';
  url.password = '';
  url.pathname = normalizePercentEncoding(url.pathname);
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParameter(key))
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  url.search = '';
  if (params.length > 0) {
    const search = new URLSearchParams();
    for (const [k, v] of params) search.append(k, v);
    url.search = search.toString();
  }
  return url.href;
}

export function isTrackingParameter(key: string): boolean {
  return key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key.toLowerCase());
}

/** Decode percent-encoded unreserved characters and upper-case the rest. */
function normalizePercentEncoding(path: string): string {
  return path
    .replace(UNRESERVED, (m) => String.fromCharCode(parseInt(m.slice(1), 16)))
    .replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
}

/** DOIs are case-insensitive; the canonical form is `doi:` plus the lower-cased name. */
export function canonicalizeDoi(doi: string): string | null {
  let name = doi.trim();
  const viaUrl = /^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i.exec(name);
  if (viaUrl) name = decodeURIComponent(viaUrl[1] as string);
  name = name.replace(/^doi:/i, '').replace(/^\/+/, '');
  if (!/^10\.\d{4,9}\/\S+$/.test(name)) return null;
  return `doi:${name.toLowerCase()}`;
}

function canonicalizeUrn(urn: string): string | null {
  const m = /^urn:([A-Za-z0-9][A-Za-z0-9-]{0,31}):(.+)$/s.exec(urn);
  if (!m) return null;
  const nid = (m[1] as string).toLowerCase();
  const nss = m[2] as string;
  // PDF fingerprints are hex digests; case carries no meaning.
  if (nid === 'x-pdf') return `urn:x-pdf:${nss.toLowerCase()}`;
  return `urn:${nid}:${nss}`;
}

/** The URI under which a PDF with this PDF.js fingerprint is identified. */
export function pdfFingerprintUri(fingerprint: string): string {
  return `urn:x-pdf:${fingerprint.trim().toLowerCase()}`;
}

/**
 * The URI for a Dublin Core identifier. With `dc.relation.ispartof` the
 * identifier is scoped to that collection, as Hypothesis also does, so that
 * identifiers that are only unique within a journal do not collide.
 */
export function dcIdentifierUri(identifier: string, isPartOf?: string): string | null {
  const id = identifier.trim();
  if (id === '') return null;
  if (isPartOf && isPartOf.trim() !== '') {
    return `urn:x-dc:${encodeURIComponent(isPartOf.trim())}/${encodeURIComponent(id)}`;
  }
  const asDoi = canonicalizeDoi(id);
  if (asDoi) return asDoi;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(id)) return canonicalizeUri(id);
  return `urn:x-dc:${encodeURIComponent(id)}`;
}
