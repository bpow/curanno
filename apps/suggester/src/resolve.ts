/**
 * Fills the IDs of a draft's items through CurAnno's lookups (ADR 0039), such
 * as a case variant's Allele Registry, ClinVar and gnomAD IDs. It fills only a
 * candidate the resolver marks `autoFill`, which leaves no choice to make.
 * Everything else is reported, and listed under `notInBatch` for the curator,
 * with the candidates.
 */
import type { components } from '@curanno/api-client';
import {
  idFieldsOf,
  lookupContext,
  lookupFieldsOf,
  needsLookup,
  withLookedUp,
  type BodyProfile,
  type FieldLookup,
  type JsonValue,
} from '@curanno/model';
import type { Draft } from './draft.ts';
import { profileForKind } from './profiles.ts';

export type Resolution = components['schemas']['Resolution'];
export type Candidate = components['schemas']['ResolutionCandidate'];
export type Resolve = (
  resolver: string,
  query: string,
  context: Record<string, string>,
) => Promise<Resolution>;

export interface LookupOutcome {
  item: string;
  /** The field looked up, and its text. */
  field: string;
  text: string;
  outcome: 'filled' | 'left' | 'failed';
  /** The values written, by field. */
  filled?: Record<string, string>;
  /** What the lookup assumed or found, for the curator. */
  notes: string[];
  /** For text left for the curator: what it could be. */
  candidates?: string[];
}

/** Thrown by a `Resolve` when no lookup can succeed, such as when the server has it turned off. */
export class LookupUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookupUnavailable';
  }
}

/** What `notInBatch` lines from this command start with, so a rerun replaces them. */
export const NOTE_PREFIX = 'Lookup';

const str = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function describe(lookup: FieldLookup, c: Candidate): string {
  const ids = new Set(idFieldsOf(lookup));
  const given = Object.entries(lookup.fill)
    .filter(([key, name]) => ids.has(name) && c.fill[key] !== undefined)
    .map(([key, name]) => `${name} ${c.fill[key]}`);
  return `${c.label} (${given.join(', ') || 'no IDs'})`;
}

/**
 * The context to look an item up with: its own fields, or else the draft's value of the same
 * name, such as its gene of interest.
 */
function contextFor(draft: Draft, value: Record<string, JsonValue>, lookup: FieldLookup) {
  const fromDraft: Record<string, string> = {};
  for (const param of Object.keys(lookup.context ?? {})) {
    const given = str((draft as unknown as Record<string, JsonValue>)[param]);
    if (given) fromDraft[param] = given;
  }
  return { ...fromDraft, ...lookupContext(value, lookup) };
}

export async function resolveDraft(
  draft: Draft,
  options: { profiles: readonly BodyProfile[]; resolve: Resolve },
): Promise<{ draft: Draft; outcomes: LookupOutcome[] }> {
  const outcomes: LookupOutcome[] = [];
  const items = [];
  for (const item of draft.items) {
    let profile: BodyProfile | undefined;
    try {
      profile = profileForKind(options.profiles, item.kind);
    } catch {
      profile = undefined;
    }
    const original = item.value;
    if (!profile || typeof original !== 'object' || original === null || Array.isArray(original)) {
      items.push(item);
      continue;
    }
    let value: Record<string, JsonValue> = original;
    for (const { field, lookup } of lookupFieldsOf(profile.schema)) {
      // IDs the article states, and text already marked unresolvable, are left as they are.
      const text = str(value[field]);
      if (!text || !needsLookup(value, field, lookup)) continue;

      let result: Resolution;
      try {
        result = await options.resolve(lookup.resolver, text, contextFor(draft, value, lookup));
      } catch (err) {
        if (err instanceof LookupUnavailable) throw err;
        outcomes.push({
          item: item.id,
          field,
          text,
          outcome: 'failed',
          notes: [(err as Error).message],
        });
        continue;
      }
      const notes = result.warnings.map((w) => w.message);
      const chosen = result.candidates.find((c) => c.autoFill);
      if (!chosen) {
        notes.push(...result.candidates.flatMap((c) => c.warnings.map((w) => w.message)));
        outcomes.push({
          item: item.id,
          field,
          text,
          outcome: 'left',
          notes: [...new Set(notes)],
          candidates: result.candidates.map((c) => describe(lookup, c)),
        });
        continue;
      }
      notes.push(...chosen.warnings.map((w) => w.message));
      // A value the article states, such as a gnomAD ID, is kept unless it is one of the IDs.
      const ids = new Set(idFieldsOf(lookup));
      const stated = Object.values(lookup.fill).filter(
        (name) => !ids.has(name) && value[name] !== undefined,
      );
      const next: Record<string, JsonValue> = withLookedUp(value, lookup, chosen.fill);
      for (const name of stated) next[name] = value[name]!;
      const filled: Record<string, string> = {};
      for (const [key, name] of Object.entries(lookup.fill)) {
        if (chosen.fill[key] !== undefined && !stated.includes(name))
          filled[name] = chosen.fill[key];
      }
      outcomes.push({ item: item.id, field, text, outcome: 'filled', filled, notes });
      value = next;
    }
    items.push(value === original ? item : { ...item, value });
  }

  // Replace this command's earlier notes, so a rerun does not repeat them.
  const kept = (draft.notInBatch ?? []).filter((n) => !n.startsWith(`${NOTE_PREFIX} `));
  const added = outcomes
    .filter((o) => o.outcome !== 'filled')
    .map((o) => {
      const what =
        o.outcome === 'failed'
          ? 'could not be looked up'
          : o.candidates?.length
            ? `needs a curator to choose: ${o.candidates.join('; ')}`
            : 'found nothing';
      return `${NOTE_PREFIX} ${o.item}: ${o.text} ${what}.${o.notes.length ? ` ${o.notes.join(' ')}` : ''}`;
    });
  const notInBatch = [...kept, ...added];
  const next = { ...draft, items };
  if (notInBatch.length) next.notInBatch = notInBatch;
  else delete next.notInBatch;
  return { draft: next, outcomes };
}
