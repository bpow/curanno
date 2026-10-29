/**
 * Document identity: which URIs identify the resource an annotation targets,
 * and the canonical form used to look them up. Specified in
 * docs/document-identity.md (ADR 0014).
 */
export {
  TRACKING_PARAMETERS,
  canonicalizeDoi,
  canonicalizeUri,
  dcIdentifierUri,
  isTrackingParameter,
  pdfFingerprintUri,
} from './canonicalize.js';
export {
  DOCUMENT_URI_RELATIONS,
  deriveDocumentUris,
  resolveLink,
  type DocumentUri,
  type DocumentUriRelation,
  type PageMetadata,
} from './identity.js';
