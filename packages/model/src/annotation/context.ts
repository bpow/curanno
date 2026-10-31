/**
 * The JSON-LD context for this platform's extension terms. Every annotation
 * the server returns names it after the W3C context, so a JSON-LD processor
 * that dereferences it learns what `StructuredBody`, `profile`, `anchoring`
 * and `permissions` mean. The server serves the document at
 * `/x/context.jsonld` under its public URL (`extensionContextIri`); the term
 * IRIs themselves are fixed, so annotations from different deployments
 * share a vocabulary.
 */
import { EXTENSION_NAMESPACE } from './types.js';

export const EXTENSION_CONTEXT_PATH = '/x/context.jsonld';

/** The IRI a deployment serves its extension context at. */
export function extensionContextIri(publicUrl: string): string {
  return `${publicUrl.replace(/\/$/, '')}${EXTENSION_CONTEXT_PATH}`;
}

const ns = EXTENSION_NAMESPACE;

/** The context document itself. */
export const EXTENSION_CONTEXT_DOCUMENT = {
  '@context': {
    '@version': 1.1,
    curanno: ns,
    // Bodies validated against a registered profile (ADR 0016).
    StructuredBody: `${ns}StructuredBody`,
    profile: { '@id': `${ns}profile`, '@type': '@id' },
    value: `${ns}value`,
    // Anchoring state and repairs on targets (ADR 0010).
    anchoring: { '@id': `${ns}anchoring`, '@type': '@id' },
    state: { '@id': `${ns}anchoringState`, '@type': '@vocab' },
    anchored: `${ns}Anchored`,
    orphaned: `${ns}Orphaned`,
    ambiguous: `${ns}Ambiguous`,
    repaired: `${ns}Repaired`,
    repair: { '@id': `${ns}repair`, '@type': '@id' },
    // The caller's permissions on the annotation (ADR 0006).
    permissions: { '@id': `${ns}permission`, '@type': '@vocab', '@container': '@set' },
    read: `${ns}Read`,
    update: `${ns}Update`,
    delete: `${ns}Delete`,
    share: `${ns}Share`,
    // Whether anyone may read the annotation (the `public` principal holds `read`).
    public: { '@id': `${ns}public`, '@type': 'http://www.w3.org/2001/XMLSchema#boolean' },
  },
} as const;
