/**
 * The `iri` format the annotation schemas use. ajv-formats has `uri` but it
 * is ASCII-only; JSON-LD identifiers are IRIs and may contain any Unicode
 * character outside the delimiters. This check requires a scheme and
 * rejects whitespace and the characters IRIs exclude; it does not attempt
 * full RFC 3987 validation.
 */
export const IRI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/u;

export function isIri(value: string): boolean {
  return IRI_PATTERN.test(value);
}

/** Minimal view of an Ajv instance, so this package does not depend on Ajv's types. */
export interface FormatRegistry {
  addFormat(name: string, format: RegExp | ((data: string) => boolean)): unknown;
}

/** Register the formats the annotation schemas need beyond ajv-formats. */
export function addAnnotationFormats<T extends FormatRegistry>(ajv: T): T {
  ajv.addFormat('iri', isIri);
  return ajv;
}
