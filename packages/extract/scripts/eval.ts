/**
 * Runs the suggestion pipeline over the evaluation corpus against a real
 * endpoint and reports how close it comes to what a curator recorded
 * (docs/extraction-plan.md, section 3.3). Not part of CI: it needs a model.
 *
 *   pnpm --filter @curanno/extract eval -- --endpoint http://localhost:11434 --model llama3.1:8b
 *
 * Options: --corpus DIR (default ./corpus), --max-chars N, --overlap N,
 * --concurrency N, --api URL (resolve ontology labels through a running
 * API's /x/ontologies), --out FILE (write every suggestion and rejection as
 * JSON), --case NAME (run one case).
 *
 * A suggestion matches an expected annotation when their quotes overlap in
 * the document. For each match, every field the expected value gives is
 * compared: `filled` when the suggestion has it, `equal` when it agrees
 * after folding case and whitespace; a list counts the share of expected
 * items (by label or variant) it contains.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  ProfileRegistry,
  addAnnotationFormats,
  addProfileKeywords,
  blockStarts,
  builtinProfiles,
  createDomAdapter,
  extractText,
  type DomLikeNode,
  type StructuredBody,
} from '@curanno/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Window } from 'happy-dom';
import {
  buildView,
  exactTerm,
  extract,
  locateQuote,
  type ExtractionResult,
  type ResolveTerms,
  type Suggestion,
  type Term,
  type TermMatch,
} from '../dist/index.js';

interface Expected {
  quote: string;
  value: Record<string, unknown>;
}

interface Case {
  name: string;
  profile: string;
  expected: Expected[];
}

const { values } = parseArgs({
  // pnpm passes its `--` separator through.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    endpoint: { type: 'string' },
    model: { type: 'string' },
    corpus: { type: 'string', default: fileURLToPath(new URL('../corpus/', import.meta.url)) },
    'max-chars': { type: 'string' },
    overlap: { type: 'string' },
    concurrency: { type: 'string' },
    api: { type: 'string' },
    out: { type: 'string' },
    case: { type: 'string' },
  },
});
if (!values.endpoint || !values.model) {
  console.error('usage: eval --endpoint URL --model NAME [--corpus DIR] [--api URL] [--out FILE]');
  process.exit(2);
}
const endpoint = { url: values.endpoint, model: values.model };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
addAnnotationFormats(ajv);
addProfileKeywords(ajv);
const registry = new ProfileRegistry(ajv, builtinProfiles);
const validate = (body: StructuredBody) => {
  const result = registry.validate(body);
  return result && !result.ok ? result.errors : [];
};

function apiTerms(api: string): ResolveTerms {
  return async (ontology, labels) => {
    const found = new Map<string, Term>();
    for (const label of labels) {
      const url = new URL(`/x/ontologies/${encodeURIComponent(ontology.name)}/terms`, api);
      url.searchParams.set('q', label);
      url.searchParams.set('limit', '10');
      if (ontology.root) url.searchParams.set('root', ontology.root);
      const response = await fetch(url);
      if (!response.ok) continue;
      const term = exactTerm(label, (await response.json()) as TermMatch[]);
      if (term) found.set(label, term);
    }
    return found;
  };
}

function loadDocument(html: string): { text: string; blockStarts: number[] } {
  const window = new Window();
  const document = new window.DOMParser().parseFromString(html, 'text/html');
  const root = document.body as unknown as DomLikeNode;
  const map = extractText(root, createDomAdapter());
  return { text: map.text, blockStarts: blockStarts(root, map) };
}

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function itemKey(item: unknown): string {
  if (typeof item === 'string') return fold(item);
  if (typeof item === 'object' && item !== null) {
    const { label, variant } = item as { label?: unknown; variant?: unknown };
    if (typeof label === 'string') return fold(label);
    if (typeof variant === 'string') return fold(variant);
  }
  return JSON.stringify(item);
}

interface FieldScore {
  filled: number;
  equal: number;
  total: number;
}

function compareFields(
  expected: Record<string, unknown>,
  actual: unknown,
  score: FieldScore,
): void {
  const got = (typeof actual === 'object' && actual !== null ? actual : {}) as Record<
    string,
    unknown
  >;
  for (const [field, want] of Object.entries(expected)) {
    score.total++;
    const have = got[field];
    if (have === undefined) continue;
    score.filled++;
    if (Array.isArray(want)) {
      const keys = new Set(Array.isArray(have) ? have.map(itemKey) : []);
      score.equal += want.length
        ? want.filter((w) => keys.has(itemKey(w))).length / want.length
        : 1;
    } else if (typeof want === 'string') {
      score.equal += typeof have === 'string' && fold(have) === fold(want) ? 1 : 0;
    } else {
      score.equal += JSON.stringify(have) === JSON.stringify(want) ? 1 : 0;
    }
  }
}

const dir = values.corpus;
const cases: Case[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    name: f.replace(/\.json$/, ''),
    ...(JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Omit<Case, 'name'>),
  }))
  .filter((c) => !values.case || c.name === values.case);

const totals = { expected: 0, suggested: 0, matched: 0, seconds: 0, chunks: 0 };
const fields: FieldScore = { filled: 0, equal: 0, total: 0 };
const reasons = new Map<string, number>();
const report: Record<string, ExtractionResult & { seconds: number }> = {};

for (const testCase of cases) {
  const profile = registry.get(testCase.profile);
  if (!profile) throw new Error(`${testCase.name}: unknown profile ${testCase.profile}`);
  const doc = loadDocument(readFileSync(path.join(dir, `${testCase.name}.html`), 'utf8'));
  const view = buildView(doc.text, doc.blockStarts);
  const whole = { start: 0, end: view.text.length };
  let chunks = 0;
  const started = performance.now();
  const result = await extract({ scopes: [{ key: 'body', ...doc }], profile }, endpoint, {
    validate,
    ...(values.api ? { resolveTerms: apiTerms(values.api) } : {}),
    ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
    chunking: {
      ...(values['max-chars'] ? { maxChars: Number(values['max-chars']) } : {}),
      ...(values.overlap ? { overlapChars: Number(values.overlap) } : {}),
    },
    onProgress: (_done, total) => (chunks = total),
  });
  const seconds = (performance.now() - started) / 1000;
  report[testCase.name] = { ...result, seconds };

  // Greedy one-to-one matching of suggestions to expected annotations by overlapping quotes.
  const unmatched = new Set<Suggestion>(result.suggestions);
  let matched = 0;
  for (const expected of testCase.expected) {
    const located = locateQuote(view, expected.quote, whole);
    if (!located.ok)
      throw new Error(`${testCase.name}: expected quote ${located.reason}: ${expected.quote}`);
    const start = [...doc.text.slice(0, located.start)].length;
    const end = start + [...doc.text.slice(located.start, located.end)].length;
    const hit = [...unmatched].find(
      (s) => s.selectors.position.start < end && s.selectors.position.end > start,
    );
    if (!hit) {
      fields.total += Object.keys(expected.value).length;
      continue;
    }
    unmatched.delete(hit);
    matched++;
    compareFields(expected.value, hit.value, fields);
  }
  for (const r of result.rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  totals.expected += testCase.expected.length;
  totals.suggested += result.suggestions.length;
  totals.matched += matched;
  totals.seconds += seconds;
  totals.chunks += chunks;
  console.log(
    `${testCase.name}: ${matched}/${testCase.expected.length} found, ${result.suggestions.length} suggested, ` +
      `${result.rejected.length} rejected, ${seconds.toFixed(1)} s`,
  );
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a');
console.log('');
console.log(`model           ${endpoint.model} at ${endpoint.url}`);
console.log(
  `recall          ${pct(totals.matched, totals.expected)} (${totals.matched}/${totals.expected})`,
);
console.log(
  `precision       ${pct(totals.matched, totals.suggested)} (${totals.matched}/${totals.suggested})`,
);
console.log(`fields filled   ${pct(fields.filled, fields.total)}`);
console.log(`fields equal    ${pct(fields.equal, fields.total)}`);
console.log(`rejected        ${[...reasons].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`);
console.log(
  `time per chunk  ${totals.chunks ? (totals.seconds / totals.chunks).toFixed(1) : 'n/a'} s`,
);
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n');
