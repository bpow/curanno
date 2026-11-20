/**
 * Reads a variant as an article gives it (docs/variant-ids-plan.md, section 2).
 * Pure: it only says what the text is, and the resolver decides what to ask.
 */

export type Coordinate = 'c' | 'g' | 'n' | 'm' | 'r' | 'p';

export interface ParsedVariant {
  /** The reference sequence, if one was given, for example `NM_000257` and `4`. */
  reference?: { accession: string; version?: string };
  /** A gene symbol given in `NM_…(GENE):` or as `GENE:c.…`. */
  gene?: string;
  coordinate: Coordinate;
  /** The change with its coordinate prefix and no whitespace, for example `c.1208G>A`. */
  change: string;
  /** A protein change given next to a nucleotide change, three-letter, for example `p.Arg403Gln`. */
  statedProtein?: string;
}

export type ParseResult = { ok: true; variant: ParsedVariant } | { ok: false; reason: string };

const ONE_TO_THREE: Record<string, string> = {
  A: 'Ala',
  R: 'Arg',
  N: 'Asn',
  D: 'Asp',
  C: 'Cys',
  E: 'Glu',
  Q: 'Gln',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  L: 'Leu',
  K: 'Lys',
  M: 'Met',
  F: 'Phe',
  P: 'Pro',
  S: 'Ser',
  T: 'Thr',
  W: 'Trp',
  Y: 'Tyr',
  V: 'Val',
  U: 'Sec',
  X: 'Ter',
  '*': 'Ter',
};

const THREE = new Set([...Object.values(ONE_TO_THREE), 'Xaa']);

/** RefSeq (`NM_000257`), Ensembl (`ENST00000355349`) and LRG (`LRG_384t1`) accessions. */
const ACCESSION = /^(?:[A-Z]{2}_\d+|ENS[A-Z]*\d{6,}|LRG_\d+(?:[tp]\d+)?)$/;

const AMINO = '(?:[A-Z][a-z]{2}|[ACDEFGHIKLMNPQRSTVWYUX*])';
/** A substitution, nonsense or synonymous change on its own: `R403Q`, `Arg403Gln`, `R403*`, `p.(R403=)`. */
const PROTEIN_SUBSTITUTION = new RegExp(`^(${AMINO})(\\d+)(${AMINO}|=)$`);

/** Cleans up what copying from a PDF or HTML page does to a variant. */
function clean(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/\s*(?:→|->|⟶|＞)\s*/g, '>')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.;,]+$/g, '')
    .replace(/\s+/g, ' ');
}

function threeLetter(code: string): string | undefined {
  if (THREE.has(code)) return code === 'Xaa' ? undefined : code;
  return ONE_TO_THREE[code];
}

/**
 * A protein change in HGVS three-letter form without its accession, or
 * the input with its parentheses removed when it is not a simple substitution.
 */
export function normalizeProteinChange(change: string): string {
  let body = change.replace(/\s+/g, '').replace(/^p\./, '');
  if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1);
  const m = PROTEIN_SUBSTITUTION.exec(body);
  if (m) {
    const from = threeLetter(m[1]!);
    const to = m[3] === '=' ? '=' : threeLetter(m[3]!);
    if (from && to) return `p.${from}${m[2]}${to}`;
  }
  return `p.${body}`;
}

/** Splits a trailing protein change off a nucleotide change: `c.1208G>A (p.Arg403Gln)`. */
function splitProtein(text: string): { rest: string; protein?: string } {
  const m =
    /^(.*?[cgnmr]\..+?)\s*(?:[;,/]|\s)\s*\(?\s*(p\.(?:\([A-Za-z0-9*=_?]+\)|[A-Za-z0-9*=_?]+))\s*\)?$/.exec(
      text,
    );
  if (!m) return { rest: text };
  return { rest: m[1]!, protein: normalizeProteinChange(m[2]!) };
}

export function parseVariant(input: string): ParseResult {
  const text = clean(input);
  if (!text) return { ok: false, reason: 'The variant is empty.' };

  // A protein change on its own, with or without `p.`.
  const bare = text.replace(/\s+/g, '').replace(/^p\./, '');
  const bareInner = bare.startsWith('(') && bare.endsWith(')') ? bare.slice(1, -1) : bare;
  if (PROTEIN_SUBSTITUTION.test(bareInner) && !/^[ACGT]\d+[ACGT]$/.test(bareInner)) {
    return { ok: true, variant: { coordinate: 'p', change: normalizeProteinChange(bare) } };
  }

  const { rest, protein } = splitProtein(text);
  const compact = rest.replace(/\s+/g, '');
  const m =
    /^(?:(?<prefix>[A-Za-z][A-Za-z0-9_-]*?)(?:\.(?<version>\d+))?(?:\((?<gene>[A-Za-z0-9-]+)\))?:)?(?<coordinate>[cgnmrp])\.(?<change>.+)$/.exec(
      compact,
    );
  if (!m?.groups) {
    return { ok: false, reason: `"${text}" is not HGVS this lookup understands.` };
  }
  const { prefix, version, gene, coordinate, change } = m.groups as {
    prefix?: string;
    version?: string;
    gene?: string;
    coordinate: Coordinate;
    change: string;
  };
  const variant: ParsedVariant = {
    coordinate,
    change: coordinate === 'p' ? normalizeProteinChange(`p.${change}`) : `${coordinate}.${change}`,
  };
  if (prefix && ACCESSION.test(prefix)) {
    variant.reference = { accession: prefix, ...(version ? { version } : {}) };
  } else if (prefix) {
    // `MYH7:c.1208G>A` names the gene, not a reference sequence.
    if (version) return { ok: false, reason: `"${prefix}.${version}" is not a known accession.` };
    variant.gene = hgncSymbol(prefix);
  }
  if (gene) variant.gene = hgncSymbol(gene);
  if (protein && coordinate !== 'p') variant.statedProtein = protein;
  return { ok: true, variant };
}

/**
 * A gene symbol as HGNC writes it. The Allele Registry matches symbols by case: all
 * capitals, except the `orf` of an open reading frame such as `C9orf72`.
 */
export function hgncSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/^(C(?:\d+|X|Y))ORF(\d)/, '$1orf$2');
}

/** The reference and change as HGVS, for example `NM_000257.4:c.1208G>A`. */
export function formatHgvs(
  reference: { accession: string; version?: string },
  change: string,
): string {
  return `${reference.accession}${reference.version ? `.${reference.version}` : ''}:${change}`;
}
