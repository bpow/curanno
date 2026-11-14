import type { HighlightTechnique } from '@curanno/model';

/** The highlights of one annotation: its identifier and nothing else (ADR 0007). */
export interface HighlightEntry {
  id: string;
  ranges: Range[];
  /** A suggestion not saved yet (ADR 0033), drawn with a dashed outline instead of a fill. */
  suggested?: boolean;
}

export interface HighlightRenderer {
  readonly technique: HighlightTechnique;
  /** Replace every highlight. */
  set(entries: HighlightEntry[]): void;
  /** Emphasise these annotations' highlights; an empty set clears. */
  focus(ids: ReadonlySet<string>): void;
  /** Show or hide every highlight without forgetting them. */
  setVisible(visible: boolean): void;
  /** Redraw after layout changed (overlay only; a no-op for CSS highlights). */
  refresh(): void;
  dispose(): void;
}

/** Identifies elements the guest owns, which the text model and observers skip. */
export const GUEST_ATTRIBUTE = 'data-curanno-guest';
