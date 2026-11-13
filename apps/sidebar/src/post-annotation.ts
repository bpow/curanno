/**
 * Posting a new annotation from an editor's draft: the document is
 * registered first, and a structured body gets its profile's default
 * purpose (ADR 0030). The composer and accepted suggestions both post
 * through this, so they stay the same.
 */
import type { OneOrMany, Target } from '@curanno/model';
import { buildInput, type AnnotationDraft } from './api/annotations';
import type { GuestDocument } from './guest';
import { useAnnotationsStore, type Versioned } from './stores/annotations';
import { useProfilesStore } from './stores/profiles';

export function usePostAnnotation() {
  const store = useAnnotationsStore();
  const profiles = useProfilesStore();
  return async function post(
    doc: GuestDocument,
    draft: AnnotationDraft,
    target: OneOrMany<Target>,
  ): Promise<Versioned> {
    await store.ensureDocument(doc);
    const structuredPurpose = draft.structured
      ? profiles.purposeOf(draft.structured.profile)
      : undefined;
    return store.create(
      buildInput(draft, target, structuredPurpose ? { structuredPurpose } : {}),
      doc.uri,
    );
  };
}
