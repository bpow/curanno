# @curanno/suggester

Runs a language model over PubMed Central articles, away from the sidebar, and posts what it suggests to CurAnno as a suggestion batch for a group to review ([ADR 0037](../../docs/adr/0037-suggestion-batches.md)). It talks to CurAnno only through the public API, with an access token ([ADR 0038](../../docs/adr/0038-access-tokens-and-service-accounts.md)). It shares the extraction pipeline with the sidebar (`@curanno/extract`), so batches come out the same either way.

## Setting up

1. An administrator creates a service account on the site's users page, and makes it an access token there.
2. A group administrator makes the service account the group's **suggester**.
3. Keep the token in the job's secret store and pass it in `CURANNO_TOKEN`.

## Running

```sh
CURANNO_TOKEN=cat_… pnpm --filter @curanno/suggester suggest -- \
  --api https://curanno.example --group <group uuid> \
  --endpoint http://localhost:1234 --model qwen3 \
  --profile individual --profile case-family --profile case-phenotypes \
  --pmcid PMC1234567 --list more-ids.txt \
  --state suggester-state.json
```

- **Articles.** `--pmcid` and `--list` (whitespace-separated PMC ids) fetch each article from PMC's open-access BioC service. `--bioc file.json` reads a BioC JSON file instead. Articles outside the open-access subset are reported and skipped.
- **Kinds.** `--profile` names a profile by its IRI or the end of it (`individual`, `case-family/1`). Kinds that others link to are asked about first, and the facts name the individuals from the same batch.
- **Engines.** `--endpoint` is any OpenAI-compatible server. For a hosted one, `--api-key-env NAME` sends the key in that environment variable. Every article's text goes to that endpoint, so choose it as you would for the sidebar.
- **State.** `--state` records which articles a run has posted, so an interrupted or nightly run picks up where it stopped. Changing the API destination, group, model endpoint, profiles, guidance, model or prompt runs an article again; `--force` runs it regardless. The batch's rerun key replaces the pending items of the previous run with the same kinds, while decided items stay. Older state files remain readable; their first run with the new fingerprint processes the articles again.
- **Trying it out.** `--dry-run` prints each batch instead of posting it, and needs no token if the deployment's profiles are public.

Scheduling is the caller's choice: run it from cron or a Kubernetes CronJob, away from peak times.

## Commands for an assistant

The `curanno-suggest` skill (`.claude/skills/curanno-suggest`) has Claude Code write a draft batch itself, instead of a model behind an endpoint. These commands support it (`docs/claude-skills-plan.md`):

| Command | Does |
| --- | --- |
| `text --pmcid … \| --bioc FILE \| --html FILE --url URL \| --pdf FILE [--url URL]` | The article as numbered passages, after its `id` (PMC id, else DOI, else URL or PDF fingerprint). `--html` reads an article page saved from a browser: a publisher's, or PMC's for articles PMC will not serve as text. `--pdf` reads a PDF, one scope per page as CurAnno's PDF viewer renders it, so the batch's targets name their page. |
| `kinds [--profile …]` | The kinds of annotation and the value each takes. |
| `terms ONTOLOGY QUERY` | Ontology terms matching the query. |
| `check DRAFT` | The draft checked against the article and the profiles: quotes verbatim, terms resolved, values valid, links sound. |
| `summarize DRAFT` | The whole-individual records the draft's facts add up to. |
| `resolve DRAFT [--out FILE]` | Looks up the IDs of the draft's items through CurAnno's lookups (ADR 0039), such as the Allele Registry, ClinVar and gnomAD IDs of its case variants, and writes the draft back. It fills IDs, with `idSource: "looked up"`, only from a candidate the lookup marks `autoFill`: for a variant, a single registered allele with nothing wrong, and, where no transcript or version was given, only when the article's protein change confirms the MANE Select one. For every other item it adds a line under `notInBatch` with the candidates and what the lookup found. Needs the token. |
| `post DRAFT --group ID` | Check, then post. |

`CURANNO_API` may stand in for `--api`.

## What is sent

- **To the model:** the article's text, and each kind's schema.
- **To CurAnno's lookups** (`resolve` only): each variant's text and gene symbol, which the API passes on to the ClinGen Allele Registry and VariantValidator.
- **To CurAnno:** the PMC and DOI URLs that identify the document, each suggestion's quote (a `TextQuoteSelector`, with no character offsets, since PMC's text does not match the curator's page offset for offset), and its value. The article's text is not sent.
