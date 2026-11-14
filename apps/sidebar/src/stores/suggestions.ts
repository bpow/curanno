/**
 * Suggested annotations (ADR 0032): the page's text from its guest, the
 * model at a configured endpoint, and what came back, highlighted in the
 * page under `urn:uuid:` identifiers until the curator accepts or discards
 * each one. Nothing here is saved: suggestions live in memory, one run at
 * a time, and go when the page or the session does.
 */
import {
  EndpointError,
  exactTerm,
  extract,
  type ResolveTerms,
  type ScopeText,
  type Suggestion,
  type Term,
} from '@curanno/extract';
import {
  pageFragmentSelector,
  type BodyProfile,
  type GuestScopeText,
  type SpecificResource,
} from '@curanno/model';
import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { useApi } from '../api/client';
import type { ExtractEndpoint } from '../config';
import type { Guest, GuestDocument } from '../guest';
import { useProfilesStore } from './profiles';

export interface SuggestionItem extends Suggestion {
  documentUri: string;
  profile: string;
  /** The suggestion's target, as a selection in the page would give it. */
  target: SpecificResource;
}

export type RunStatus = 'idle' | 'reading' | 'asking' | 'done' | 'failed' | 'cancelled';

export interface RunRequest {
  document: GuestDocument;
  profile: BodyProfile;
  endpoint: ExtractEndpoint;
  model: string;
  instructions?: string;
}

function scopeKey(scope: GuestScopeText): string {
  return scope.page === undefined ? 'body' : `page=${scope.page}`;
}

function toScopeText(scope: GuestScopeText): ScopeText {
  return {
    key: scopeKey(scope),
    text: scope.text,
    ...(scope.blockStarts ? { blockStarts: scope.blockStarts } : {}),
  };
}

/** The target for a suggestion: the scope's selectors, inside a page fragment for a PDF page. */
export function targetOf(documentUri: string, suggestion: Suggestion): SpecificResource {
  const selectors = [suggestion.selectors.quote, suggestion.selectors.position];
  const page = /^page=(\d+)$/.exec(suggestion.scope)?.[1];
  return {
    type: 'SpecificResource',
    source: documentUri,
    selector: page ? [pageFragmentSelector(Number(page), selectors)] : selectors,
  };
}

/** Ontology labels resolved through `/x/ontologies`; only an exact label or synonym counts. */
const resolveTerms: ResolveTerms = async (ontology, labels) => {
  const found = new Map<string, Term>();
  for (const label of labels) {
    try {
      const { data } = await useApi().GET('/x/ontologies/{name}/terms', {
        params: {
          path: { name: ontology.name },
          query: { q: label, limit: 10, ...(ontology.root ? { root: ontology.root } : {}) },
        },
      });
      const term = data ? exactTerm(label, data) : undefined;
      if (term) found.set(label, term);
    } catch {
      // An ontology that is not loaded leaves the label as written.
    }
  }
  return found;
};

function messageOf(err: unknown): string {
  if (err instanceof EndpointError) {
    return err.status === undefined
      ? `${err.message}. If this is Ollama, check that it is running and that OLLAMA_ORIGINS allows ${window.location.origin}.`
      : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export const useSuggestionsStore = defineStore('suggestions', () => {
  const items = shallowRef<SuggestionItem[]>([]);
  const status = ref<RunStatus>('idle');
  const progress = ref<{ done: number; total: number }>();
  const error = ref<string>();
  const rejected = ref(0);
  let controller: AbortController | undefined;

  function withdraw(guest: Guest, ids: string[]): void {
    if (ids.length) guest.unanchor(ids);
    items.value = items.value.filter((i) => !ids.includes(i.id));
  }

  /** Withdraw every suggestion and forget the last run. */
  function clear(guest: Guest): void {
    controller?.abort();
    controller = undefined;
    withdraw(
      guest,
      items.value.map((i) => i.id),
    );
    status.value = 'idle';
    progress.value = undefined;
    error.value = undefined;
    rejected.value = 0;
  }

  function cancel(): void {
    controller?.abort();
  }

  async function run(guest: Guest, request: RunRequest): Promise<void> {
    clear(guest);
    const own = new AbortController();
    controller = own;
    const { document, profile } = request;
    status.value = 'reading';
    try {
      const scopes = await guest.requestText(document.uri);
      if (own.signal.aborted) throw own.signal.reason;
      if (!scopes)
        throw new Error('This page cannot send its text. Reload it to update the guest.');
      status.value = 'asking';
      const profiles = useProfilesStore();
      const result = await extract(
        {
          scopes: scopes.map(toScopeText),
          profile,
          ...(request.instructions?.trim() ? { instructions: request.instructions } : {}),
        },
        { url: request.endpoint.url, model: request.model },
        {
          validate: (body) => profiles.validate(body),
          resolveTerms,
          signal: own.signal,
          onProgress: (done, total) => {
            if (controller === own) progress.value = { done, total };
          },
        },
      );
      if (controller !== own) return;
      const next = result.suggestions.map((s) => ({
        ...s,
        documentUri: document.uri,
        profile: profile.iri,
        target: targetOf(document.uri, s),
      }));
      items.value = next;
      rejected.value = result.rejected.length;
      guest.anchor(
        next.map((i) => ({ id: i.id, target: i.target, style: 'suggested' as const })),
        document.uri,
      );
      status.value = 'done';
    } catch (err) {
      if (controller !== own) return;
      if (own.signal.aborted) {
        status.value = 'cancelled';
      } else {
        status.value = 'failed';
        error.value = messageOf(err);
      }
    } finally {
      if (controller === own) controller = undefined;
    }
  }

  /** Drop a suggestion once it was saved as an annotation, or the curator discarded it. */
  function discard(guest: Guest, id: string): void {
    withdraw(guest, [id]);
  }

  return {
    items,
    status,
    progress,
    error,
    rejected,
    run,
    cancel,
    clear,
    discard,
  };
});
