/**
 * The suggestion pipeline (docs/extraction-plan.md, section 3): scope texts
 * and a profile in; suggestions out, each a quote that occurs verbatim in
 * its scope, described as the guest would describe it, with a value that
 * validates against the profile. Everything the model returned that did not
 * make it is listed as a rejection with its reason.
 */
import {
  describeRange,
  utf16ToCodePoint,
  type Agent,
  type BodyProfile,
  type JsonValue,
  type StructuredBody,
  type TextSelectors,
  type ValidationError,
} from '@curanno/model';
import { chunkText, type Chunk, type ChunkOptions } from './chunk.js';
import {
  EndpointError,
  complete,
  completionRequest,
  parseAnswer,
  type Endpoint,
  type RawSuggestion,
} from './endpoint.js';
import { locateQuote } from './locate.js';
import { PROMPT_VERSION, buildMessages } from './prompt.js';
import { outputSchema } from './schema.js';
import { resolveOntologyFields, type ResolveTerms } from './terms.js';
import { buildView, type ScopeView } from './view.js';

/** One text-model scope: a page's body, or one PDF page. */
export interface ScopeText {
  /** Opaque to the pipeline; returned on each suggestion so the caller can build its target. */
  key: string;
  /** The scope's normalized text (text model, sections 4–7). */
  text: string;
  /** Code point offsets where blocks begin (`blockStarts`), for the model's view only. */
  blockStarts?: readonly number[];
}

export interface ExtractionInput {
  scopes: readonly ScopeText[];
  profile: BodyProfile;
  /** The curator's guidance, added to every request. */
  instructions?: string;
}

export interface Suggestion {
  /** `urn:uuid:` identifier, for highlighting before anything is saved. */
  id: string;
  scope: string;
  selectors: TextSelectors;
  value: JsonValue;
  /** Labels in ontology fields that the lookup did not match. */
  unresolvedTerms: string[];
  /** The body's creator and creation time when the curator accepts it (ADR 0034). */
  creator: Agent;
  created: string;
}

export type RejectionReason = 'unparseable' | 'too-short' | 'not-found' | 'ambiguous' | 'invalid';

export interface Rejection {
  scope: string;
  reason: RejectionReason;
  quote?: string;
  value?: unknown;
  errors?: readonly ValidationError[];
}

export interface ExtractionResult {
  suggestions: Suggestion[];
  rejected: Rejection[];
}

export interface ExtractOptions {
  /** Validation errors for a body of the profile; the caller's `ProfileRegistry`. */
  validate: (body: StructuredBody) => readonly ValidationError[];
  resolveTerms?: ResolveTerms;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Requests in flight at once. Default 2: a local GPU serves one at a time anyway. */
  concurrency?: number;
  chunking?: ChunkOptions;
  /** Called after each chunk with how many are done and how many there are. */
  onProgress?: (done: number, total: number) => void;
  now?: () => Date;
}

export const GENERATOR_NAME = 'curanno-extract';

/** The body creator recorded for a suggestion from `model` (ADR 0034). */
export function softwareAgent(model: string): Agent {
  return {
    type: 'Software',
    name: GENERATOR_NAME,
    nickname: `${model} / prompt ${PROMPT_VERSION}`,
  };
}

interface Job {
  scope: ScopeText;
  view: ScopeView;
  chunk: Chunk;
  /** 1-based position of the chunk in its scope, and the scope's number of chunks. */
  part: number;
  parts: number;
}

/** Drop empty strings, nulls and empty arrays and objects, which models use for "not stated". */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, prune(v)] as const)
      .filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === null) return undefined;
  if (typeof value === 'string') return value.trim() ? value.trim() : undefined;
  return value;
}

/** JSON with object keys sorted, so equal values compare equal whatever order their keys came in. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function randomUrn(): string {
  return `urn:uuid:${globalThis.crypto.randomUUID()}`;
}

export async function extract(
  input: ExtractionInput,
  endpoint: Endpoint,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const { profile } = input;
  const { schema, valueSchema, ontologyFields } = outputSchema(profile);
  const jobs: Job[] = input.scopes.flatMap((scope) => {
    const view = buildView(scope.text, scope.blockStarts);
    const chunks = chunkText(view.text, options.chunking);
    return chunks.map((chunk, i) => ({ scope, view, chunk, part: i + 1, parts: chunks.length }));
  });

  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const created = (options.now?.() ?? new Date()).toISOString();
  const creator = softwareAgent(endpoint.model);
  const seen = new Set<string>();
  const found: { order: number; suggestion: Suggestion }[] = [];
  const rejected: Rejection[] = [];
  let done = 0;

  async function ask(job: Job): Promise<RawSuggestion[] | undefined> {
    const messages = buildMessages({
      profile,
      valueSchema,
      chunk: job.chunk.text,
      part: job.part,
      parts: job.parts,
      instructions: input.instructions,
    });
    const request = completionRequest(endpoint, messages, schema);
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await complete(endpoint, request, {
        ...(options.fetch ? { fetch: options.fetch } : {}),
        signal: controller.signal,
      });
      // An endpoint may answer after the caller gave up; its answer no longer counts.
      controller.signal.throwIfAborted();
      const answer = parseAnswer(content);
      if (answer) return answer;
    }
    return undefined;
  }

  async function run(index: number): Promise<void> {
    const job = jobs[index] as Job;
    const key = job.scope.key;
    const answer = await ask(job);
    if (!answer) {
      rejected.push({ scope: key, reason: 'unparseable' });
      return;
    }
    for (const raw of answer) {
      const located = locateQuote(job.view, raw.quote, job.chunk);
      if (!located.ok) {
        rejected.push({ scope: key, reason: located.reason, quote: raw.quote, value: raw.value });
        continue;
      }
      const pruned = prune(raw.value) ?? {};
      const resolved = await resolveOntologyFields(pruned, ontologyFields, options.resolveTerms);
      const value = resolved.value as JsonValue;
      const errors = options.validate({ type: 'StructuredBody', profile: profile.iri, value });
      if (errors.length) {
        rejected.push({ scope: key, reason: 'invalid', quote: raw.quote, value, errors });
        continue;
      }
      const source = job.view.source;
      const range = {
        start: utf16ToCodePoint(source, located.start),
        end: utf16ToCodePoint(source, located.end),
      };
      const dedupe = `${key}\n${range.start}\n${range.end}\n${stableStringify(value)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      found.push({
        order: input.scopes.indexOf(job.scope) * 1e9 + range.start,
        suggestion: {
          id: randomUrn(),
          scope: key,
          selectors: describeRange(source, range),
          value,
          unresolvedTerms: resolved.unresolved,
          creator,
          created,
        },
      });
    }
  }

  try {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const index = next++;
        await run(index);
        options.onProgress?.(++done, jobs.length);
      }
    };
    const workers = Array.from({ length: Math.max(1, options.concurrency ?? 2) }, worker);
    await Promise.all(workers).catch((err: unknown) => {
      controller.abort(err);
      throw err;
    });
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
  return {
    suggestions: found.sort((a, b) => a.order - b.order).map((f) => f.suggestion),
    rejected,
  };
}

export { EndpointError };
