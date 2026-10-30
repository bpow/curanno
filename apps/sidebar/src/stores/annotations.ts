/**
 * The annotations of the current document, loaded from `/x/search` and kept
 * current by the event stream. Writes go through the W3C protocol with the
 * ETag the caller last saw (`If-Match`), so a 412 reaches the UI as a
 * conflict rather than a silent overwrite.
 */
import type { Annotation, AnnotationInput } from '@scale/api-client';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { annotationUuid, parentIri } from '../api/annotations';
import { useApi } from '../api/client';
import { toProblem, unwrap, type Problem } from '../api/problems';
import type { GuestDocument } from '../guest';

const PAGE = 200;
const MAX_PAGES = 50;

export interface Versioned {
  annotation: Annotation;
  etag: string | undefined;
}

export type AnnotationEventKind = 'created' | 'updated' | 'deleted';

export const useAnnotationsStore = defineStore('annotations', () => {
  const documentUri = ref<string>();
  const items = ref(new Map<string, Annotation>());
  const loading = ref(false);
  const problem = ref<Problem>();
  const registeredDocuments = new Set<string>();

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

  function upsert(annotation: Annotation): void {
    items.value.set(annotation.id, annotation);
  }

  function remove(iri: string): void {
    items.value.delete(iri);
  }

  async function load(uri: string): Promise<void> {
    documentUri.value = uri;
    items.value = new Map();
    loading.value = true;
    problem.value = undefined;
    try {
      const next = new Map<string, Annotation>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const results = unwrap(
          await useApi().GET('/x/search', {
            params: { query: { uri, limit: PAGE, offset: page * PAGE, sort: 'created' } },
          }),
        );
        for (const a of results.items) next.set(a.id, a);
        if (results.items.length < PAGE || next.size >= results.total) break;
      }
      if (documentUri.value === uri) items.value = next;
    } catch (err) {
      problem.value = toProblem(err);
    } finally {
      loading.value = false;
    }
  }

  /** Tells the server the page's identifiers once per document (docs/document-identity.md). */
  async function ensureDocument(doc: GuestDocument): Promise<void> {
    if (registeredDocuments.has(doc.uri)) return;
    unwrap(
      await useApi().POST('/x/documents', {
        body: { uri: doc.uri, ...(doc.title ? { title: doc.title } : {}), links: doc.links },
      }),
    );
    registeredDocuments.add(doc.uri);
  }

  async function create(input: AnnotationInput): Promise<Versioned> {
    const result = await useApi().POST('/annotations/', { body: input });
    const annotation = unwrap(result);
    upsert(annotation);
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

  /** Merges one event from the stream. Updates for annotations not yet seen are additions. */
  function applyEvent(kind: AnnotationEventKind, iri: string, annotation?: Annotation): void {
    if (kind === 'deleted') {
      remove(iri);
    } else if (annotation) {
      upsert(annotation);
    }
  }

  return {
    documentUri,
    items,
    loading,
    problem,
    all,
    roots,
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
