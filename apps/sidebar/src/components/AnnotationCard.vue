<script setup lang="ts">
import type { Annotation } from '@curanno/api-client';
import { computed, ref } from 'vue';
import {
  annotationUuid,
  buildInput,
  can,
  commentOf,
  creatorName,
  creatorUserId,
  draftOf,
  isEdited,
  quoteOf,
  rebuildInput,
  repairInput,
  storedAnchoring,
  structuredBodies,
  tagsOf,
  type AnnotationDraft,
} from '../api/annotations';
import { toProblem, type Problem } from '../api/problems';
import { useAuthStore } from '../auth/store';
import { useGuest } from '../guest';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import { formatTime } from '../util/time';
import AnchoringBadge from './AnchoringBadge.vue';
import AnnotationEditor from './AnnotationEditor.vue';
import ProblemAlert from './ProblemAlert.vue';
import SharingPanel from './SharingPanel.vue';
import StructuredBodyView from './StructuredBodyView.vue';

const props = defineProps<{ annotation: Annotation; reply?: boolean }>();

const store = useAnnotationsStore();
const profiles = useProfilesStore();
const auth = useAuthStore();
const guest = useGuest();

type Mode = 'view' | 'edit' | 'reply' | 'share';
const mode = ref<Mode>('view');
const busy = ref(false);
const problem = ref<Problem>();
const etag = ref<string>();
const editDraft = ref<AnnotationDraft>(draftOf(props.annotation));
const replyDraft = ref<AnnotationDraft>({ text: '', tags: [] });

const quote = computed(() => quoteOf(props.annotation));
const comment = computed(() => commentOf(props.annotation));
const tags = computed(() => tagsOf(props.annotation));
const structured = computed(() => structuredBodies(props.annotation));
const anchoring = computed(
  () => guest.anchoring.value.get(props.annotation.id) ?? storedAnchoring(props.annotation),
);
const hovered = computed(() => guest.hovered.value.includes(props.annotation.id));
/** Made on another site and not sent to this page (ADR 0025). */
const withheld = computed(() => guest.withheld.value.get(props.annotation.id));
const repairable = computed(
  () =>
    !props.reply &&
    !withheld.value &&
    (anchoring.value === 'orphaned' || anchoring.value === 'ambiguous') &&
    can(props.annotation, 'update') &&
    guest.selection.value !== undefined,
);

/** Focus leaving the card altogether un-emphasises its highlight. */
function onFocusOut(event: FocusEvent): void {
  const card = event.currentTarget as HTMLElement;
  if (!(event.relatedTarget instanceof Node) || !card.contains(event.relatedTarget)) {
    guest.focus([]);
  }
}

function setMode(next: Mode): void {
  mode.value = mode.value === next ? 'view' : next;
  problem.value = undefined;
}

async function beginEdit(): Promise<void> {
  if (mode.value === 'edit') return setMode('view');
  await reloadForEdit();
  mode.value = 'edit';
}

async function reloadForEdit(): Promise<void> {
  busy.value = true;
  try {
    const current = await store.fetch(props.annotation.id);
    etag.value = current.etag;
    editDraft.value = draftOf(current.annotation);
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function saveEdit(draft: AnnotationDraft): Promise<void> {
  if (!etag.value) return;
  busy.value = true;
  try {
    const structuredPurpose = draft.structured
      ? profiles.purposeOf(draft.structured.profile)
      : undefined;
    const input = rebuildInput(props.annotation, draft, {
      ...(structuredPurpose ? { structuredPurpose } : {}),
    });
    await store.update(props.annotation.id, input, etag.value);
    mode.value = 'view';
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function saveReply(draft: AnnotationDraft): Promise<void> {
  busy.value = true;
  try {
    const structuredPurpose = draft.structured
      ? profiles.purposeOf(draft.structured.profile)
      : undefined;
    const created = await store.create(
      buildInput(draft, props.annotation.id, {
        reply: true,
        ...(structuredPurpose ? { structuredPurpose } : {}),
      }),
    );
    replyDraft.value = { text: '', tags: [] };
    // Back to view before sharing so that a failed share cannot be retried as a second reply.
    mode.value = 'view';
    problem.value = undefined;
    if (draft.acl) await store.share(created.annotation.id, draft.acl);
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  if (!window.confirm('Delete this annotation?')) return;
  busy.value = true;
  try {
    const current = await store.fetch(props.annotation.id);
    if (!current.etag) throw new Error('the server sent no ETag');
    await store.destroy(props.annotation.id, current.etag);
    guest.unanchor([props.annotation.id]);
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function repair(): Promise<void> {
  const selection = guest.selection.value;
  if (!selection?.target.selector) return;
  busy.value = true;
  try {
    const current = await store.fetch(props.annotation.id);
    if (!current.etag) throw new Error('the server sent no ETag');
    const updated = await store.update(
      props.annotation.id,
      repairInput(current.annotation, selection.target.selector),
      current.etag,
    );
    guest.clearSelection();
    guest.anchor(
      [
        {
          id: updated.annotation.id,
          target: updated.annotation.target,
          public: updated.annotation.public === true,
        },
      ],
      store.documentOf.get(props.annotation.id),
    );
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article
    :id="`annotation-${annotationUuid(annotation.id)}`"
    class="card"
    :class="{ reply, hovered }"
    tabindex="-1"
    :aria-label="`Annotation by ${creatorName(annotation)}`"
    @mouseenter="guest.focus([annotation.id])"
    @mouseleave="guest.focus([])"
    @focusin="guest.focus([annotation.id])"
    @focusout="onFocusOut"
  >
    <header>
      <span class="creator">{{ creatorName(annotation) }}</span>
      <time :datetime="annotation.created" class="muted">{{ formatTime(annotation.created) }}</time>
      <span v-if="isEdited(annotation)" class="muted" :title="formatTime(annotation.modified)">
        (edited)
      </span>
      <span
        v-if="!reply && withheld"
        class="badge elsewhere"
        :title="`Made on ${withheld.source}; not highlighted on this page`"
      >
        from {{ withheld.source }}
      </span>
      <AnchoringBadge v-else-if="!reply" :state="anchoring" />
    </header>

    <blockquote v-if="quote && !reply" class="quote">
      <button
        type="button"
        class="quote-button"
        :title="'Show in the page'"
        @click="guest.scrollTo(annotation.id)"
      >
        {{ quote }}
      </button>
    </blockquote>

    <template v-if="mode === 'edit'">
      <AnnotationEditor
        :draft="editDraft"
        :busy="busy"
        :problem="problem"
        @save="saveEdit"
        @cancel="setMode('view')"
        @reload="reloadForEdit"
      />
    </template>
    <template v-else>
      <p v-if="comment" class="comment">{{ comment }}</p>
      <StructuredBodyView v-for="(body, i) in structured" :key="i" :body="body" />
      <ul v-if="tags.length" class="tags" aria-label="Tags">
        <li v-for="tag in tags" :key="tag">{{ tag }}</li>
      </ul>
      <ProblemAlert v-if="problem" :problem="problem" />
    </template>

    <footer v-if="auth.status === 'authenticated' && mode !== 'edit'" class="actions">
      <button type="button" class="link" :disabled="busy" @click="setMode('reply')">Reply</button>
      <button
        v-if="can(annotation, 'update')"
        type="button"
        class="link"
        :disabled="busy"
        @click="beginEdit"
      >
        Edit
      </button>
      <button
        v-if="can(annotation, 'share')"
        type="button"
        class="link"
        :disabled="busy"
        :aria-expanded="mode === 'share'"
        @click="setMode('share')"
      >
        Share
      </button>
      <button
        v-if="can(annotation, 'delete')"
        type="button"
        class="link danger"
        :disabled="busy"
        @click="remove"
      >
        Delete
      </button>
      <button v-if="repairable" type="button" class="link" :disabled="busy" @click="repair">
        Repair with selection
      </button>
    </footer>

    <AnnotationEditor
      v-if="mode === 'reply'"
      :draft="replyDraft"
      submit-label="Reply"
      placeholder="Write a reply"
      :busy="busy"
      sharing
      :problem="problem"
      @save="saveReply"
      @cancel="setMode('view')"
    />
    <SharingPanel
      v-if="mode === 'share'"
      :annotation-id="annotationUuid(annotation.id)"
      :creator-id="creatorUserId(annotation)"
    />
  </article>
</template>

<style scoped>
.card {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.card.hovered {
  border-color: var(--accent);
}

.card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.card.reply {
  border-color: transparent;
  border-left: 2px solid var(--border);
  border-radius: 0;
  padding: 0.4rem 0.75rem;
}

.badge.elsewhere {
  font-size: 0.75em;
  padding: 0 0.4em;
  border-radius: 999px;
  border: 1px solid currentColor;
  color: var(--muted);
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.9em;
}

.creator {
  font-weight: 600;
}

.quote {
  margin: 0.4rem 0;
  padding: 0;
  border-left: 3px solid light-dark(#f2c94c, #a67c00);
}

.quote-button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 0;
  background: none;
  padding: 0.2rem 0.6rem;
  color: var(--muted);
  font-style: italic;
  overflow-wrap: anywhere;
}

.quote-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.comment {
  margin: 0.3rem 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tags {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.3rem 0;
  padding: 0;
}

.tags li {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 0.5rem;
  font-size: 0.85em;
}

.actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.3rem;
  font-size: 0.9em;
}

.actions .link {
  text-decoration: none;
}
</style>
