/**
 * A guest for development and tests. It has no page: the document comes
 * from the `uri` query parameter or a setter, selections are typed into the
 * dev panel, everything it is asked to anchor anchors, and focus and scroll
 * calls are logged so a developer can see the sidebar's side of the
 * conversation.
 */
import type { AnchoringState } from '@curanno/model';
import { computed, ref, shallowReadonly, shallowRef, type Ref } from 'vue';
import type { AnchorRequest, DocumentSelection, Guest, GuestDocument } from './types';

export interface FakeGuestOptions {
  document?: GuestDocument;
}

export interface FakeGuest extends Guest {
  readonly log: Readonly<Ref<readonly string[]>>;
  setDocument(uri: string, title?: string): void;
  /** Pretends the user selected `quote` in the page. */
  select(quote: string, context?: { prefix?: string; suffix?: string }): void;
  /** Overrides the result the next `anchor()` reports for an annotation. */
  setAnchoringResult(id: string, state: AnchoringState): void;
  /** Pretends the user hovered or clicked highlights in the page. */
  hover(ids: string[]): void;
  activate(ids: string[]): void;
}

export const DEFAULT_DOCUMENT_URI = 'https://example.test/sample-document';

export function documentFromLocation(search = window.location.search): GuestDocument {
  const uri = new URLSearchParams(search).get('uri') || DEFAULT_DOCUMENT_URI;
  return { uri, links: [{ uri, relation: 'self' }] };
}

export function createFakeGuest(options: FakeGuestOptions = {}): FakeGuest {
  const document = shallowRef<GuestDocument | undefined>(options.document);
  const documents = computed(() => (document.value ? [document.value] : []));
  const selection = shallowRef<DocumentSelection>();
  const anchoring = shallowRef<ReadonlyMap<string, AnchoringState>>(new Map());
  const hovered = shallowRef<readonly string[]>([]);
  const log = ref<string[]>([]);
  const overrides = new Map<string, AnchoringState>();
  const activateHandlers = new Set<(ids: string[]) => void>();

  const note = (line: string): void => {
    log.value = [...log.value.slice(-19), line];
  };

  return {
    document: shallowReadonly(document),
    documents,
    selection: shallowReadonly(selection),
    anchoring: shallowReadonly(anchoring),
    hovered: shallowReadonly(hovered),
    log: shallowReadonly(log),

    setDocument(uri, title) {
      document.value = { uri, ...(title ? { title } : {}), links: [{ uri, relation: 'self' }] };
      selection.value = undefined;
      anchoring.value = new Map();
    },
    select(quote, context = {}) {
      const doc = document.value ?? documentFromLocation('');
      const source = doc.uri;
      selection.value = {
        document: doc,
        quote,
        target: {
          type: 'SpecificResource',
          source,
          selector: {
            type: 'TextQuoteSelector',
            exact: quote,
            ...(context.prefix ? { prefix: context.prefix } : {}),
            ...(context.suffix ? { suffix: context.suffix } : {}),
          },
        },
      };
    },
    setAnchoringResult(id, state) {
      overrides.set(id, state);
    },
    hover(ids) {
      hovered.value = ids;
    },
    activate(ids) {
      for (const handler of activateHandlers) handler(ids);
    },

    anchor(requests: AnchorRequest[]) {
      const next = new Map(anchoring.value);
      for (const request of requests) next.set(request.id, overrides.get(request.id) ?? 'anchored');
      anchoring.value = next;
      note(`anchor ${requests.length}`);
    },
    unanchor(ids) {
      const next = new Map(anchoring.value);
      for (const id of ids) next.delete(id);
      anchoring.value = next;
      note(`unanchor ${ids.length}`);
    },
    focus(ids) {
      note(ids.length ? `focus ${ids.map(shortId).join(', ')}` : 'focus none');
    },
    scrollTo(id) {
      note(`scroll to ${shortId(id)}`);
    },
    clearSelection() {
      selection.value = undefined;
    },
    onActivate(handler) {
      activateHandlers.add(handler);
      return () => activateHandlers.delete(handler);
    },
  };
}

function shortId(iri: string): string {
  return iri.slice(-8);
}
