/**
 * The annotations of the documents the guests show (the page, and any
 * frames with documents of their own), loaded from `/x/search` per document
 * and kept current by one event stream each. Writes go through the W3C
 * protocol with the ETag the caller last saw (`If-Match`), so a 412 reaches
 * the UI as a conflict rather than a silent overwrite.
 */
import type { Annotation, AnnotationInput } from '@curanno/api-client';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { annotationUuid, parentIri } from '../api/annotations';
import { useApi } from '../api/client';
import { toProblem, unwrap, type Problem } from '../api/problems';
import { subscribeAnnotationEvents, type LiveStatus } from '../events/subscribe';
import type { GuestDocument } from '../guest';

const PAGE = 200;
const MAX_PAGES = 50;

export interface Versioned {
  annotation: Annotation;
  etag: string | undefined;
}

export type AnnotationEventKind = 'created' | 'updated' | 'deleted';

export const useAnnotationsStore = defineStore('annotations', () => {
  /** The documents loaded, in the guests' order (the page first). */
  const documentUris = ref<string[]>([]);
  const items = ref(new Map<string, Annotation>());
  /** Which document each annotation was loaded or received for. */
  const documentOf = ref(new Map<string, string>());
  const loading = ref(false);
  const problem = ref<Problem>();
  const registeredDocuments = new Set<string>();
  const liveByDocument = ref(new Map<string, LiveStatus>());
  const liveControllers = new Map<string, AbortController>();
  let loadGeneration = 0;

  /** The event streams' state: `open` when every document's is, else the least settled. */
  const live = computed<LiveStatus>(() => {
    const states = [...liveByDocument.value.values()];
    if (states.length === 0) return 'closed';
    for (const s of ['closed', 'retrying', 'connecting'] as const) if (states.includes(s)) return s;
    return 'open';
  });
  /** The page's own document, for callers that need one. */
  const documentUri = computed(() => documentUris.value[0]);

  const all = computed(() => [...items.value.values()]);
  const byCreated = (a: Annotation, b: Annotation) =>
    (a.created ?? '').localeCompare(b.created ?? '');
  /** Top-level annotations, newest first. */
  const roots = computed(() =>
    all.value.filter((a) => parentIri(a) === undefined).sort((a, b) => byCreated(b, a)),
  );
  const repliesByParent = computed(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of all.value) {
      const parent = parentIri(a);
      if (parent === undefined) continue;
      const list = map.get(parent) ?? [];
      list.push(a);
      map.set(parent, list);
    }
    for (const list of map.values()) list.sort(byCreated);
    return map;
  });

  function repliesTo(iri: string): Annotation[] {
    return repliesByParent.value.get(iri) ?? [];
  }

  function upsert(annotation: Annotation, uri?: string): void {
    items.value.set(annotation.id, annotation);
    if (uri) documentOf.value.set(annotation.id, uri);
  }

  function remove(iri: string): void {
    items.value.delete(iri);
    documentOf.value.delete(iri);
  }

  /** Top-level annotations of one document, newest first. */
  function rootsOf(uri: string): Annotation[] {
    return roots.value.filter((a) => documentOf.value.get(a.id) === uri);
  }

  async function search(uri: string): Promise<Annotation[]> {
    const found: Annotation[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const results = unwrap(
        await useApi().GET('/x/search', {
          params: { query: { uri, limit: PAGE, offset: page * PAGE, sort: 'created' } },
        }),
      );
      found.push(...results.items);
      if (results.items.length < PAGE || found.length >= results.total) break;
    }
    return found;
  }

  /**
   * Makes the store hold these documents' annotations: documents no longer
   * shown are dropped, new ones loaded, the rest kept unless `reload` asks
   * for everything again (the session changed, so what is readable changed).
   */
  async function load(uris: string[], options: { reload?: boolean } = {}): Promise<void> {
    const wanted = new Set(uris);
    const previous = new Set(documentUris.value);
    documentUris.value = [...uris];
    for (const [iri, uri] of [...documentOf.value]) if (!wanted.has(uri)) remove(iri);
    const toLoad = options.reload ? uris : uris.filter((uri) => !previous.has(uri));
    if (toLoad.length === 0) return;
    const generation = ++loadGeneration;
    loading.value = true;
    problem.value = undefined;
    try {
      const results = await Promise.all(
        toLoad.map(async (uri) => [uri, await search(uri)] as const),
      );
      // Loads overlap when frames connect one after another; each merges
      // what is still shown by the time it finishes.
      const shown = new Set(documentUris.value);
      const next = new Map(items.value);
      const nextDocumentOf = new Map(documentOf.value);
      for (const [uri, found] of results) {
        if (!shown.has(uri)) continue;
        for (const [iri, known] of nextDocumentOf) {
          if (known === uri) {
            next.delete(iri);
            nextDocumentOf.delete(iri);
          }
        }
        for (const a of found) {
          next.set(a.id, a);
          nextDocumentOf.set(a.id, uri);
        }
      }
      items.value = next;
      documentOf.value = nextDocumentOf;
    } catch (err) {
      problem.value = toProblem(err);
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  /** Tells the server the page's identifiers once per document (docs/document-identity.md). */
  async function ensureDocument(doc: GuestDocument): Promise<void> {
    if (registeredDocuments.has(doc.uri)) return;
    unwrap(
      await useApi().POST('/x/documents', {
        body: {
          uri: doc.uri,
          ...(doc.title ? { title: doc.title } : {}),
          links: doc.links.map(({ uri, relation }) => ({ uri, relation })),
        },
      }),
    );
    registeredDocuments.add(doc.uri);
  }

  async function create(input: AnnotationInput, uri?: string): Promise<Versioned> {
    const result = await useApi().POST('/annotations/', { body: input });
    const annotation = unwrap(result);
    upsert(annotation, uri ?? documentUri.value);
    return { annotation, etag: result.response.headers.get('etag') ?? undefined };
  }

  /** The current representation and its ETag, for an edit or delete about to start. */
  async function fetch(iri: string): Promise<Versioned> {
    const result = await useApi().GET('/annotations/{id}', {
      params: { path: { id: annotationUuid(iri) } },
    });
    const annotation = unwrap(result);
    upsert(annotation);
    return { annotation, etag: result.response.headers.get('etag') ?? undefined };
  }

  async function update(iri: string, input: AnnotationInput, etag: string): Promise<Versioned> {
    const result = await useApi().PUT('/annotations/{id}', {
      params: { path: { id: annotationUuid(iri) }, header: { 'If-Match': etag } },
      body: input,
    });
    const annotation = unwrap(result);
    upsert(annotation);
    return { annotation, etag: result.response.headers.get('etag') ?? undefined };
  }

  async function destroy(iri: string, etag: string): Promise<void> {
    unwrap(
      await useApi().DELETE('/annotations/{id}', {
        params: { path: { id: annotationUuid(iri) }, header: { 'If-Match': etag } },
      }),
    );
    remove(iri);
  }

  /**
   * Merges one event from a document's stream. Updates for annotations not
   * yet seen are additions, attributed to that document.
   */
  function applyEvent(
    kind: AnnotationEventKind,
    id: string,
    annotation?: Annotation,
    uri = documentUri.value,
  ): void {
    if (kind === 'deleted') {
      for (const iri of items.value.keys()) {
        if (annotationUuid(iri) === id) remove(iri);
      }
    } else if (annotation) {
      upsert(annotation, documentOf.value.get(annotation.id) ?? uri);
    }
  }

  /** Follows these documents' event streams, one each, until `stopLive()` or the next call. */
  function startLive(uris: string[]): void {
    const wanted = new Set(uris);
    for (const [uri, controller] of [...liveControllers]) {
      if (wanted.has(uri)) continue;
      controller.abort();
      liveControllers.delete(uri);
      liveByDocument.value.delete(uri);
    }
    for (const uri of uris) {
      if (liveControllers.has(uri)) continue;
      const controller = new AbortController();
      liveControllers.set(uri, controller);
      liveByDocument.value.set(uri, 'connecting');
      void subscribeAnnotationEvents({
        uri,
        signal: controller.signal,
        onStatus: (status) => {
          if (liveControllers.get(uri) === controller) liveByDocument.value.set(uri, status);
        },
        onEvent: (event) => {
          if (liveControllers.get(uri) !== controller) return;
          applyEvent(event.kind, event.id, event.annotation, uri);
        },
      });
    }
  }

  function stopLive(): void {
    for (const controller of liveControllers.values()) controller.abort();
    liveControllers.clear();
    liveByDocument.value = new Map();
  }

  return {
    live,
    startLive,
    stopLive,
    documentUri,
    documentUris,
    documentOf,
    items,
    loading,
    problem,
    all,
    roots,
    rootsOf,
    repliesTo,
    load,
    ensureDocument,
    create,
    fetch,
    update,
    destroy,
    applyEvent,
    upsert,
    remove,
  };
});
