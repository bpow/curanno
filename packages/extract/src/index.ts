/**
 * Annotation suggestions from a language model (ADR 0032): the pipeline
 * from a document's scope texts and a body profile to quotes that anchor
 * and values that validate. Free of DOM, framework and API client, so the
 * sidebar and the evaluation CLI share it.
 */
export {
  chunkText,
  DEFAULT_MAX_CHARS,
  DEFAULT_OVERLAP_CHARS,
  type Chunk,
  type ChunkOptions,
} from './chunk.js';
export {
  EndpointError,
  complete,
  completionRequest,
  completionsUrl,
  parseAnswer,
  type CompletionRequest,
  type Endpoint,
  type RawSuggestion,
} from './endpoint.js';
export {
  GENERATOR_NAME,
  extract,
  softwareAgent,
  type ExtractOptions,
  type ExtractionInput,
  type ExtractionResult,
  type Rejection,
  type RejectionReason,
  type ScopeText,
  type Suggestion,
} from './extract.js';
export { MIN_QUOTE_LENGTH, locateQuote, type Located } from './locate.js';
export { PROMPT_VERSION, buildMessages, type ChatMessage } from './prompt.js';
export {
  UnsupportedProfileError,
  outputSchema,
  type OntologyField,
  type OutputSchema,
  type ValuePath,
} from './schema.js';
export {
  exactTerm,
  resolveOntologyFields,
  type ResolveTerms,
  type Term,
  type TermMatch,
} from './terms.js';
export { BLOCK_SEPARATOR, buildView, toSource, type ScopeView } from './view.js';
