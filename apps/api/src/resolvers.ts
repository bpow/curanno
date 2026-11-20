/**
 * Resolvers find the IDs an authority gives to something an article names in its
 * own words (ADR 0039). Each answers `GET /x/resolve/{resolver}` with candidates
 * and never chooses for the curator.
 */

export interface ResolutionWarning {
  /** Part of the contract; each resolver documents its own codes. */
  code: string;
  message: string;
}

export interface ResolutionStep {
  /** The outside service, named for people. */
  service: string;
  request: string;
  outcome: string;
}

export interface ResolutionCandidate {
  label: string;
  /** The values this candidate fills, under names the resolver documents. */
  fill: Record<string, string>;
  /** What an editor shows about the candidate. A fact with no values reads as none. */
  facts: { label: string; values: { text: string; url?: string }[] }[];
  /** The one candidate a program may fill without asking a curator. */
  autoFill?: true;
  warnings: ResolutionWarning[];
}

export interface Resolution {
  query: string;
  /** The context as the resolver used it. */
  context: Record<string, string>;
  candidates: ResolutionCandidate[];
  warnings: ResolutionWarning[];
  steps: ResolutionStep[];
}

export interface Resolver {
  resolve(query: string, context: Record<string, string>): Promise<Resolution>;
}

/** An outside service could not be reached, or answered in a way we cannot read. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}
