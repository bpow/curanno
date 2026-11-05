/**
 * Shared by the load-test scripts: a seeded random number generator, the
 * vocabulary the seed writes into bodies and quotes, and the names the seed
 * gives principals and documents so that the load runner can find them.
 */

/** The issuer seeded users belong to; the load runner mints tokens for it. */
export const LOAD_ISSUER = 'https://load.test';
export const LOAD_CLIENT_ID = 'curanno-sidebar';

export const userSubject = (i: number): string => `load-user-${i}`;
export const groupName = (i: number): string => `load-group-${i}`;
export const documentUri = (i: number): string => `https://load.example/docs/${i}`;

/** mulberry32: small, fast, and the same sequence on every platform. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, to derive independent streams from one seed and a stage name. */
export function hashSeed(seed: number, name: string): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Random = () => number;

export const randomInt = (rand: Random, min: number, maxInclusive: number): number =>
  min + Math.floor(rand() * (maxInclusive - min + 1));

export function uuidFrom(rand: Random): string {
  const hex = (n: number) =>
    Math.floor(rand() * 2 ** n)
      .toString(16)
      .padStart(n / 4, '0');
  const variant = (8 + Math.floor(rand() * 4)).toString(16);
  return `${hex(32)}-${hex(16)}-4${hex(12)}-${variant}${hex(12)}-${hex(32)}${hex(16)}`;
}

/** Samples ranks 0..n-1 with probability proportional to 1/(rank+1)^s. */
export class Zipf {
  private readonly cumulative: Float64Array;

  constructor(n: number, s: number) {
    this.cumulative = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += 1 / (i + 1) ** s;
      this.cumulative[i] = total;
    }
    for (let i = 0; i < n; i++) this.cumulative[i] = (this.cumulative[i] as number) / total;
  }

  sample(rand: Random): number {
    const u = rand();
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.cumulative[mid] as number) < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

// Function words first, in roughly their English frequency order: to_tsvector
// drops them, as it would in real annotations. Then a curation vocabulary
// and ordinary English, so that the most frequent lexemes are real words
// the load runner can search for at known ranks.
const FUNCTION_WORDS =
  `the of and to in a is that for it as was with be by on not he this are or his
from at which but have an had they you were their one all we can her has there been if more when will
would who so no she my than about out up into them then its only other new some could time these two
may first do any like now over such our man me even most made after also did many before must through
back years where much your way well down should because each just those people how too little state`.split(
    /\s+/,
  );

const DOMAIN_WORDS = `variant pathogenic benign evidence segregation cohort proband phenotype gene
classification criteria allele frequency population functional assay missense nonsense frameshift
splice exon intron promoter transcript protein domain conserved residue penetrance expressivity
inheritance dominant recessive de novo mosaic germline somatic family pedigree affected unaffected
carrier onset age symptom diagnosis clinical report literature study case control patient sample
sequencing panel exome genome coverage read depth quality filter artifact confirmed validated
curator reviewer committee consensus dispute uncertain likely strong moderate supporting conflicting
rule guideline framework threshold score summary rationale citation figure table supplement method
result discussion conclusion hypothesis mechanism pathway expression knockout model mouse zebrafish
cell line tissue blood plasma serum biopsy imaging scan measurement baseline follow-up outcome
treatment response dose trial enrolled excluded randomized blinded placebo adverse effect risk odds
ratio interval confidence significant association linkage locus region chromosome deletion duplication
inversion translocation copy number repeat expansion methylation imprinting haplotype ancestry`.split(
  /\s+/,
);

const GENERAL_WORDS = `annotation comment note question answer page paragraph sentence section
heading quote highlight reference link source author editor published revised draft version
important interesting unclear wrong correct agree disagree check verify compare contrast explain
describe argue suggest propose reject accept consider mention observe measure estimate predict
assume conclude summarize revisit clarify confirm doubt wonder remember forget read write look
find show mean need want see know think take give make come go say get use work call try ask
seem feel leave put keep let begin help talk turn start might move live believe hold bring happen
write provide sit stand lose pay meet include continue set learn change lead understand watch follow
stop create speak allow add spend grow open walk win offer appear buy wait serve die send expect
build stay fall cut reach kill remain large small early young old long great high different good
bad right left public private clear simple complex narrow wide full empty strong weak dark light`.split(
  /\s+/,
);

const SYLLABLES = [
  'ka',
  'te',
  'mo',
  'ri',
  'sun',
  'vel',
  'dor',
  'ith',
  'pra',
  'quen',
  'lor',
  'bex',
  'nu',
  'gal',
  'wen',
  'oph',
];

/**
 * The vocabulary, most frequent first. Real words take the top ranks; the
 * long tail of rarer lexemes a corpus has is made of pseudo-words. Term
 * frequencies follow a Zipf law over the rank.
 */
export function vocabulary(size = 4000): string[] {
  const words = [...FUNCTION_WORDS, ...DOMAIN_WORDS, ...GENERAL_WORDS];
  const seen = new Set(words);
  // Three syllables of sixteen give 4096 pseudo-words, twice that with the suffix.
  let n = 0;
  while (words.length < size) {
    if (n >= 2 * SYLLABLES.length ** 3) throw new Error(`cannot make ${size} distinct words`);
    let w = '';
    let k = n++;
    for (let i = 0; i < 3; i++) {
      w += SYLLABLES[k % SYLLABLES.length];
      k = Math.floor(k / SYLLABLES.length);
    }
    if (n % 2 === 0) w += 'ine';
    if (!seen.has(w)) {
      seen.add(w);
      words.push(w);
    }
  }
  return words.slice(0, size);
}

/** Zipf exponent of word frequencies in the seeded text. */
export const WORD_ZIPF_EXPONENT = 1.05;

/** Words the load runner searches for, by rank: the most common content word, a mid one and a rare one. */
export const SEARCH_TERM_RANKS = {
  common: FUNCTION_WORDS.length,
  mid: 400,
  rare: 2500,
} as const;

export class TextGenerator {
  private readonly words: string[];
  private readonly zipf: Zipf;
  private readonly rand: Random;

  constructor(rand: Random) {
    this.rand = rand;
    this.words = vocabulary();
    this.zipf = new Zipf(this.words.length, WORD_ZIPF_EXPONENT);
  }

  word(): string {
    return this.words[this.zipf.sample(this.rand)] as string;
  }

  phrase(min: number, max: number): string {
    const n = randomInt(this.rand, min, max);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(this.word());
    return out.join(' ');
  }

  sentence(): string {
    const s = this.phrase(6, 18);
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  paragraph(): string {
    const n = randomInt(this.rand, 1, 3);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(this.sentence());
    return out.join(' ');
  }

  /** A content word: ranks past the function words. */
  contentWord(): string {
    const start = FUNCTION_WORDS.length;
    return this.words[randomInt(this.rand, start, start + 160)] as string;
  }
}

/** Parses `--name value` and `--flag` arguments. */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !(argv[i + 1] as string).startsWith('--')) {
      out[arg.slice(2)] = argv[++i] as string;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

export function numberArg(
  args: Record<string, string | true>,
  name: string,
  fallback: number,
): number {
  const value = args[name];
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
  return n;
}
