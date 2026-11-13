import {
  ProfileRegistry,
  addProfileKeywords,
  caseIndividualProfile,
  evidenceExcerptProfile,
  type StructuredBody,
} from '@curanno/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { EndpointError } from './endpoint.js';
import { extract, softwareAgent, type ExtractOptions } from './extract.js';
import { PROMPT_VERSION } from './prompt.js';
import { answer, createFakeEndpoint, documentOf } from './testing.js';

const registry = new ProfileRegistry(
  addProfileKeywords(new Ajv2020({ allErrors: true, strict: false })),
  [evidenceExcerptProfile, caseIndividualProfile],
);

function validate(body: StructuredBody) {
  const result = registry.validate(body);
  return result && !result.ok ? result.errors : [];
}

const endpoint = { url: 'http://localhost:11434', model: 'test-model' };
const now = () => new Date('2026-11-13T12:00:00Z');

const TEXT =
  'Functional studies showed reduced activity. The variant was absent from gnomAD. ' +
  'Then reduced activity was confirmed in a second assay.';

function options(fake: ReturnType<typeof createFakeEndpoint>, more: Partial<ExtractOptions> = {}) {
  return { validate, fetch: fake.fetch, now, ...more };
}

describe('extract', () => {
  it('returns anchored, validated suggestions with selectors and provenance', async () => {
    const fake = createFakeEndpoint(() =>
      answer([
        { quote: 'Functional studies showed reduced activity.', value: { kind: 'functional' } },
        {
          quote: 'The variant was absent from gnomAD.',
          value: { kind: 'population', summary: '' },
        },
      ]),
    );
    const result = await extract(
      { scopes: [{ key: 'body', text: TEXT }], profile: evidenceExcerptProfile },
      endpoint,
      options(fake),
    );
    expect(result.rejected).toEqual([]);
    expect(result.suggestions).toHaveLength(2);
    const [first, second] = result.suggestions;
    expect(first).toMatchObject({
      scope: 'body',
      value: { kind: 'functional' },
      unresolvedTerms: [],
      created: '2026-11-13T12:00:00.000Z',
      creator: {
        type: 'Software',
        name: 'curanno-extract',
        nickname: `test-model / prompt ${PROMPT_VERSION}`,
      },
      selectors: {
        quote: { type: 'TextQuoteSelector', exact: 'Functional studies showed reduced activity.' },
        position: { type: 'TextPositionSelector', start: 0, end: 43 },
      },
    });
    expect(first?.id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    // The empty summary was dropped rather than failing minLength.
    expect(second?.value).toEqual({ kind: 'population' });
    expect(second?.selectors.quote.prefix).toBe(
      'ctional studies showed reduced activity. '.slice(-32),
    );
  });

  it('sends the profile, the schema and the curator guidance', async () => {
    const fake = createFakeEndpoint(() => answer([]));
    await extract(
      {
        scopes: [{ key: 'body', text: TEXT }],
        profile: evidenceExcerptProfile,
        instructions: 'Only functional evidence.',
      },
      endpoint,
      options(fake),
    );
    const [request] = fake.requests;
    expect(request?.model).toBe('test-model');
    expect(request?.temperature).toBe(0);
    expect(request?.response_format.type).toBe('json_schema');
    expect(request?.messages[0]?.content).toContain('Evidence excerpt');
    expect(request?.messages[1]?.content).toContain('Only functional evidence.');
    expect(documentOf(request!)).toBe(TEXT);
  });

  it('rejects quotes that do not anchor and values that do not validate', async () => {
    const fake = createFakeEndpoint(() =>
      answer([
        { quote: 'The enzyme was inactive.', value: { kind: 'functional' } },
        { quote: 'reduced activity', value: { kind: 'functional' } },
        { quote: 'The variant was absent from gnomAD.', value: { kind: 'rumour' } },
        { quote: 'ok', value: { kind: 'other' } },
      ]),
    );
    const result = await extract(
      { scopes: [{ key: 'body', text: TEXT }], profile: evidenceExcerptProfile },
      endpoint,
      options(fake),
    );
    expect(result.suggestions).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'not-found',
      'ambiguous',
      'invalid',
      'too-short',
    ]);
    expect(result.rejected[2]?.errors?.[0]?.instancePath).toBe('/value/kind');
  });

  it('asks again once when the answer is not JSON, then gives up on that chunk', async () => {
    const replies = [
      'not json',
      answer([{ quote: 'The variant was absent from gnomAD.', value: { kind: 'population' } }]),
    ];
    const fake = createFakeEndpoint((_r, call) => replies[call] ?? 'still not json');
    const ok = await extract(
      { scopes: [{ key: 'body', text: TEXT }], profile: evidenceExcerptProfile },
      endpoint,
      options(fake),
    );
    expect(ok.suggestions).toHaveLength(1);
    expect(fake.requests).toHaveLength(2);

    const never = createFakeEndpoint(() => '```json\n{"nope": true}\n```');
    const failed = await extract(
      { scopes: [{ key: 'body', text: TEXT }], profile: evidenceExcerptProfile },
      endpoint,
      options(never),
    );
    expect(failed.rejected).toEqual([{ scope: 'body', reason: 'unparseable' }]);
    expect(never.requests).toHaveLength(2);
  });

  it('chunks long scopes, reports progress and drops what the overlap found twice', async () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Observation ${i} was recorded here.`);
    const text = sentences.join(' ');
    const fake = createFakeEndpoint((request) => {
      const chunk = documentOf(request);
      return answer(
        sentences
          .filter((s) => chunk.includes(s))
          .map((s) => ({ quote: s, value: { kind: 'other' } })),
      );
    });
    const progress: [number, number][] = [];
    const result = await extract(
      { scopes: [{ key: 'body', text }], profile: evidenceExcerptProfile },
      endpoint,
      options(fake, {
        chunking: { maxChars: 300, overlapChars: 80 },
        onProgress: (done, total) => progress.push([done, total]),
      }),
    );
    expect(fake.requests.length).toBeGreaterThan(3);
    expect(progress.at(-1)).toEqual([fake.requests.length, fake.requests.length]);
    expect(result.suggestions.map((s) => s.selectors.quote.exact)).toEqual(sentences);
  });

  it('gives the model paragraphs and anchors in the normalized text', async () => {
    const text = 'Patient 1 had seizures.Patient 2 had ataxia.';
    const fake = createFakeEndpoint(() =>
      answer([
        {
          quote: 'Patient 2 had ataxia.',
          value: {
            case: 'Patient 2',
            variants: [{ variant: 'c.1A>G' }],
            casePresentingHpos: ['ataxia', 'gait trouble'],
          },
        },
      ]),
    );
    const result = await extract(
      { scopes: [{ key: 'body', text, blockStarts: [23] }], profile: caseIndividualProfile },
      endpoint,
      options(fake, {
        resolveTerms: (ontology, labels) => {
          expect(ontology).toEqual({ name: 'hp', root: 'HP:0000118' });
          return Promise.resolve(
            new Map(
              labels
                .filter((l) => l === 'ataxia')
                .map((l) => [l, { id: 'HP:0001251', label: 'Ataxia' }]),
            ),
          );
        },
      }),
    );
    expect(documentOf(fake.requests[0]!)).toBe('Patient 1 had seizures.\n\nPatient 2 had ataxia.');
    expect(result.suggestions[0]).toMatchObject({
      selectors: { position: { start: 23, end: 44 } },
      value: {
        casePresentingHpos: [{ id: 'HP:0001251', label: 'Ataxia' }, { label: 'gait trouble' }],
      },
      unresolvedTerms: ['gait trouble'],
    });
  });

  it('keeps each suggestion with its own scope, in scope order', async () => {
    const fake = createFakeEndpoint((request) =>
      answer([{ quote: documentOf(request).slice(0, 20), value: { kind: 'case' } }]),
    );
    const result = await extract(
      {
        scopes: [
          { key: 'page=1', text: 'First page text is about one case.' },
          { key: 'page=2', text: 'Second page text is about another.' },
        ],
        profile: evidenceExcerptProfile,
      },
      endpoint,
      options(fake, { concurrency: 2 }),
    );
    expect(result.suggestions.map((s) => s.scope)).toEqual(['page=1', 'page=2']);
  });

  it('fails the run on an endpoint error', async () => {
    const fake = createFakeEndpoint(() => new Response('model not found', { status: 404 }));
    await expect(
      extract(
        { scopes: [{ key: 'body', text: TEXT }], profile: evidenceExcerptProfile },
        endpoint,
        options(fake),
      ),
    ).rejects.toThrow(EndpointError);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const fake = createFakeEndpoint(() => {
      controller.abort();
      return answer([]);
    });
    const text = 'z '.repeat(5000);
    await expect(
      extract(
        { scopes: [{ key: 'body', text }], profile: evidenceExcerptProfile },
        endpoint,
        options(fake, { signal: controller.signal, concurrency: 1, chunking: { maxChars: 1000 } }),
      ),
    ).rejects.toThrow();
    expect(fake.requests).toHaveLength(1);
  });

  it('names the model in the body creator', () => {
    expect(softwareAgent('llama3.1:8b')).toEqual({
      type: 'Software',
      name: 'curanno-extract',
      nickname: `llama3.1:8b / prompt ${PROMPT_VERSION}`,
    });
  });
});
