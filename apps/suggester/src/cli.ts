#!/usr/bin/env node
/**
 * Suggested annotations for articles (PMC, publishers' pages, PDFs), posted for a group to
 * review in CurAnno (ADR 0037, 0038). Commands:
 *
 *   run    --pmcid … --profile … --endpoint URL --model NAME --group ID
 *          a model behind an OpenAI-compatible endpoint suggests, and the batch is posted
 *   text   --pmcid … | --bioc FILE | --html FILE [--url URL] | --pdf FILE [--url URL] [--save FILE] [--out FILE]
 *          the article as numbered passages (JSON), for an assistant to read
 *   kinds  [--profile …]
 *          the kinds of annotation and the value each takes (JSON)
 *   terms  ONTOLOGY QUERY
 *          ontology terms matching QUERY, through the API (JSON)
 *   check  DRAFT [--bioc FILE | --html FILE [--url URL] | --pdf FILE [--url URL]]
 *          a draft batch checked against the article and the profiles (JSON); exit 1 on problems
 *   summarize DRAFT [same article options as check]
 *          the whole-individual records the draft's facts add up to (JSON)
 *   resolve DRAFT [--out FILE]
 *          fill the IDs of the draft's items, such as its variants, through CurAnno's lookups,
 *          writing the draft back (or to FILE) and listing what is left for a curator under notInBatch
 *   post   DRAFT --group ID [same article options as check]
 *          check, then post the batch
 *
 * Every command but `text` needs --api (or CURANNO_API), and `post` and
 * `run` the token in CURANNO_TOKEN (or --token-env). See README.md and docs/claude-skills-plan.md.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ApiError, createApiClient, unwrap, type ApiClient } from '@curanno/api-client';
import { outputSchema } from '@curanno/extract';
import { linkFieldsOf, summarizeIndividuals, type BodyProfile } from '@curanno/model';
import { articleFromBioc, fetchBioc, type Article } from './bioc.ts';
import { checkDraft, type Draft } from './draft.ts';
import { articleFromHtml } from './html.ts';
import { articleFromPdf } from './pdf.ts';
import {
  loadProfiles,
  profileForKind,
  shortKind,
  termResolver,
  type Profiles,
} from './profiles.ts';
import { runKey, suggestFor } from './run.ts';
import { State } from './state.ts';
import { LookupUnavailable, resolveDraft } from './resolve.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    api: {
      type: 'string',
      ...(process.env['CURANNO_API'] ? { default: process.env['CURANNO_API'] } : {}),
    },
    'token-env': { type: 'string', default: 'CURANNO_TOKEN' },
    group: { type: 'string' },
    endpoint: { type: 'string' },
    model: { type: 'string' },
    'api-key-env': { type: 'string' },
    profile: { type: 'string', multiple: true, default: [] },
    pmcid: { type: 'string', multiple: true, default: [] },
    list: { type: 'string' },
    bioc: { type: 'string', multiple: true, default: [] },
    html: { type: 'string' },
    pdf: { type: 'string' },
    url: { type: 'string' },
    'bioc-url': { type: 'string' },
    save: { type: 'string' },
    out: { type: 'string' },
    instructions: { type: 'string' },
    state: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function required(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

function client(needsToken: boolean): ApiClient {
  const token = process.env[values['token-env']];
  if (needsToken && !token) {
    throw new Error(
      `set ${values['token-env']} to an access token with the suggestions:write scope`,
    );
  }
  return createApiClient({ baseUrl: required('api'), ...(token ? { token: () => token } : {}) });
}

async function profiles(api: ApiClient): Promise<Profiles> {
  return loadProfiles(api).catch((err: unknown) => {
    throw new Error(`could not read the profiles from ${values.api}: ${(err as Error).message}`);
  });
}

const biocOptions = () => (values['bioc-url'] ? { base: values['bioc-url'] } : {});

/** The one article a command is about: a saved page, a PDF, a BioC file, or a PMC id fetched from the service. */
async function oneArticle(pmcid?: string): Promise<{ article: Article; raw: unknown }> {
  if (values.pdf) {
    const data = new Uint8Array(await readFile(values.pdf));
    return { article: await articleFromPdf(data, values.url), raw: undefined };
  }
  if (values.html) {
    const html = await readFile(values.html, 'utf8');
    return { article: articleFromHtml(html, values.url), raw: undefined };
  }
  const file = values.bioc[0];
  const raw = file
    ? (JSON.parse(await readFile(file, 'utf8')) as unknown)
    : await fetchBioc((values.pmcid[0] ?? pmcid ?? '').toUpperCase(), biocOptions());
  return { article: articleFromBioc(raw), raw };
}

/** The value a kind takes in a draft: the model's view of it, with links as local ids. */
function draftValueSchema(profile: BodyProfile): unknown {
  const { valueSchema } = outputSchema(profile);
  const properties = { ...(valueSchema['properties'] as Record<string, unknown>) };
  const required = [...((valueSchema['required'] as string[] | undefined) ?? [])];
  for (const { field, link, multiple } of linkFieldsOf(profile.schema)) {
    const one = {
      type: 'string',
      pattern: '^_:[A-Za-z0-9_-]{1,64}$',
      description: `The local id of a ${link.profile} item of the same draft.`,
    };
    properties[field] = multiple
      ? { type: 'array', minItems: 1, items: one, description: 'Every one the passage is about.' }
      : one;
    const declared = (profile.schema['required'] as string[] | undefined) ?? [];
    if (declared.includes(field) && !required.includes(field)) required.unshift(field);
  }
  return { ...valueSchema, properties, required };
}

const commands: Record<string, () => Promise<number>> = {
  async text() {
    const { article, raw } = await oneArticle();
    if (values.save && raw !== undefined) await writeFile(values.save, JSON.stringify(raw));
    const text = {
      id: article.id,
      ...(article.title ? { title: article.title } : {}),
      document: article.document,
      passages: article.passages,
    };
    if (values.out) {
      await writeFile(values.out, `${JSON.stringify(text, null, 2)}\n`);
      console.error(`${article.id}: ${article.passages.length} passages in ${values.out}`);
    } else {
      print(text);
    }
    return 0;
  },

  async kinds() {
    const { all } = await profiles(client(false));
    const chosen = values.profile.length
      ? values.profile.map((k) => profileForKind(all, k))
      : all.filter((p) => {
          try {
            return profileForKind(all, p.iri) === p;
          } catch {
            return false;
          }
        });
    print(
      chosen.map((p) => ({
        kind: shortKind(p),
        iri: p.iri,
        title: p.title,
        ...(p.description ? { description: p.description } : {}),
        value: draftValueSchema(p),
      })),
    );
    return 0;
  },

  async terms() {
    const [, ontology, ...words] = positionals;
    if (!ontology || !words.length) throw new Error('usage: terms ONTOLOGY QUERY');
    const api = client(false);
    print(
      unwrap(
        await api.GET('/x/ontologies/{name}/terms', {
          params: { path: { name: ontology }, query: { q: words.join(' '), limit: 20 } },
        }),
      ),
    );
    return 0;
  },

  async check() {
    const { result } = await checked(client(false));
    print(result);
    return result.problems.length ? 1 : 0;
  },

  /** The whole-individual records the draft's facts add up to, as if every item were accepted. */
  async summarize() {
    const api = client(false);
    const { result } = await checked(api);
    if (!result.batch) {
      print(result);
      return 1;
    }
    const { registry } = await profiles(api);
    const annotations = result.batch.items.map((i) => ({ id: i.id, body: i.body }));
    const { individuals, unlinked } = summarizeIndividuals(
      annotations as Parameters<typeof summarizeIndividuals>[0],
      (body) => {
        const r = registry.validate(body);
        return r && !r.ok ? r.errors : [];
      },
    );
    print({
      individuals: individuals.map((i) => ({
        individual: i.individual,
        facts: i.facts.length,
        value: i.value,
        ...(i.errors.length ? { incomplete: i.errors.map((e) => e.message) } : {}),
      })),
      unlinked,
    });
    return 0;
  },

  /** IDs for the draft's items, such as its variants (ADR 0039); left alone where a curator must choose. */
  async resolve() {
    const file = positionals[1];
    if (!file) throw new Error('usage: resolve DRAFT [--out FILE]');
    const draft = JSON.parse(await readFile(file, 'utf8')) as Draft;
    const api = client(true);
    const { all } = await profiles(api);
    const { draft: next, outcomes } = await resolveDraft(draft, {
      profiles: all,
      resolve: async (resolver, q, context) => {
        try {
          return unwrap(
            await api.GET('/x/resolve/{resolver}', {
              params: { path: { resolver }, query: { ...context, q } },
            }),
          );
        } catch (err) {
          if (err instanceof ApiError && [401, 403, 404].includes(err.problem.status)) {
            throw new LookupUnavailable(
              `${resolver} lookup is not available at ${values.api}: ${err.problem.detail ?? err.problem.title}`,
            );
          }
          throw err instanceof ApiError ? new Error(err.problem.detail ?? err.problem.title) : err;
        }
      },
    });
    await writeFile(values.out ?? file, `${JSON.stringify(next, null, 2)}\n`);
    const count = (o: string) => outcomes.filter((x) => x.outcome === o).length;
    print({ filled: count('filled'), left: count('left'), failed: count('failed'), outcomes });
    return 0;
  },

  async post() {
    const group = required('group');
    const api = client(true);
    const { result } = await checked(api);
    if (!result.batch) {
      print(result);
      return 1;
    }
    const posted = unwrap(
      await api.POST('/x/suggestion-batches', { body: { ...result.batch, group } }),
    );
    print({ batch: posted.id, items: posted.counts.pending });
    return 0;
  },

  async run() {
    const api = client(!values['dry-run']);
    const apiKeyEnv = values['api-key-env'];
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
    if (apiKeyEnv && !apiKey) throw new Error(`${apiKeyEnv} is not set`);
    const endpoint = {
      url: required('endpoint'),
      model: required('model'),
      ...(apiKey ? { apiKey } : {}),
    };
    const group = values['dry-run'] ? (values.group ?? '') : required('group');
    if (!values.profile.length) throw new Error('name at least one --profile, such as individual');
    const { all, validate } = await profiles(api);
    const kinds = values.profile.map((k) => profileForKind(all, k));
    const run = runKey({
      apiUrl: required('api'),
      group,
      endpoint,
      kinds,
      ...(values.instructions ? { instructions: values.instructions } : {}),
    });
    const state = await State.open(values.state);

    const ids = [...values.pmcid];
    if (values.list) {
      const listed = await readFile(values.list, 'utf8');
      ids.push(...listed.split(/\s+/).filter((l) => /^PMC\d+$/i.test(l)));
    }
    const sources: (() => Promise<Article>)[] = [
      ...values.bioc.map(
        (file) => async () => articleFromBioc(JSON.parse(await readFile(file, 'utf8'))),
      ),
      ...ids.map(
        (id) => async () => articleFromBioc(await fetchBioc(id.toUpperCase(), biocOptions())),
      ),
    ];
    if (!sources.length) throw new Error('name articles with --pmcid, --list or --bioc');

    let failures = 0;
    for (const load of sources) {
      let article: Article;
      try {
        article = await load();
      } catch (err) {
        failures++;
        console.error(`skipped: ${(err as Error).message}`);
        continue;
      }
      if (!values.force && state.isDone(article.id, run)) {
        console.error(`${article.id}: done already`);
        continue;
      }
      try {
        const outcome = await suggestFor(article, {
          api,
          group,
          endpoint,
          kinds,
          validate,
          ...(values.instructions ? { instructions: values.instructions } : {}),
          dryRun: values['dry-run'],
          onProgress: (p) => {
            if (p.done === p.total) {
              console.error(`${article.id}: ${p.kind} (${p.step} of ${p.steps}) read`);
            }
          },
        });
        const notes = [
          `${outcome.items} suggestion${outcome.items === 1 ? '' : 's'}`,
          ...(outcome.rejected ? [`${outcome.rejected} set aside`] : []),
          ...(outcome.skipped.length ? [`not asked about ${outcome.skipped.join(', ')}`] : []),
        ];
        if (values['dry-run']) print(outcome.body ?? null);
        else await state.record(article.id, run, outcome.batch);
        console.error(
          `${article.id}: ${notes.join('; ')}${outcome.batch ? `, posted as batch ${outcome.batch}` : ''}`,
        );
      } catch (err) {
        failures++;
        console.error(`${article.id}: failed: ${(err as Error).message}`);
      }
    }
    return failures ? 1 : 0;
  },
};

/** The draft named on the command line, checked against its article and the profiles. */
async function checked(api: ApiClient) {
  const file = positionals[1];
  if (!file) throw new Error(`usage: ${positionals[0]} DRAFT`);
  const draft = JSON.parse(await readFile(file, 'utf8')) as Draft;
  const { article } = await oneArticle(draft.article);
  const { all, registry } = await profiles(api);
  const result = await checkDraft(draft, article, {
    profiles: all,
    registry,
    resolveTerms: termResolver(api),
  });
  return { draft, result };
}

const command = commands[positionals[0] ?? ''];
if (!command) {
  console.error(`usage: curanno-suggester <${Object.keys(commands).join('|')}> [options]`);
  process.exit(2);
}
command().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error((err as Error).message);
    if (err instanceof ApiError && err.problem.errors?.length) {
      for (const e of err.problem.errors) console.error(`  ${e.instancePath || '/'}: ${e.message}`);
    }
    process.exit(2);
  },
);
