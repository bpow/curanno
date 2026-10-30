# Third-party code and licenses

This document tracks code we copy from other projects or depend on heavily enough that its license terms shape what we must do. It is kept current at every release. Copied code also keeps its original license notice in the copied files.

## Inventory

| Project                                                                  | Version or commit reviewed                    | License                                         | Obligations                                                                                 | Status         |
| ------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| [Hypothesis client](https://github.com/hypothesis/client)                | `main` at `a7b7400d0d70`, copied 2026-10-29   | BSD-2-Clause; Annotator-derived parts under MIT | Keep both the BSD-2-Clause and MIT notices in any copied files. Note the copyright holders. | Copied: anchoring modules in `packages/guest/vendor/hypothesis/` with `LICENSE` and `PROVENANCE.md`; `xpath.ts` and the quote scoring ported into `packages/guest/src/anchoring/`, headers say so |
| [Recogito Text Annotator](https://github.com/recogito/text-annotator-js) | v4.3.7                                        | BSD-3-Clause                                    | Keep the notice. Do not use contributor names to endorse or promote derived work.           | Not copied; devDependency of `@curanno/guest` for the Phase 2 trial only |
| [Apache Annotator](https://github.com/apache/incubator-annotator)        | Final source before retirement in 2025        | Apache-2.0                                      | Keep the LICENSE and NOTICE files. Mark changed files as modified. Patent terms apply.      | Not yet copied |
| [Annotator](https://github.com/openannotation/annotator)                 | 2.0.0-alpha                                   | MIT or GPL-3.0-or-later (dual)                  | If ever copied, take it under the MIT option and keep that notice.                          | Not yet copied |
| Anchoring corpus pages (`packages/guest/corpus/cases/`)                  | Fetched 2026-10-29                            | Wikipedia CC BY-SA 4.0; MDN CC BY-SA 2.5; PLOS CC BY 4.0; Project Gutenberg public domain | Keep the attribution in each page and in the corpus README; edited variants are derivative works under the same licenses | Stored, for testing only |

Dependencies installed through pnpm are not listed individually here; CI checks their licenses against the allowed list below.

## Allowed licenses for dependencies

The following licenses are allowed for dependencies without further discussion:

- MIT
- BSD-2-Clause
- BSD-3-Clause
- Apache-2.0
- ISC
- 0BSD
- Unlicense
- CC0-1.0
- Python-2.0
- BlueOak-1.0.0

Copyleft licenses (GPL, LGPL, AGPL, MPL) require an accepted ADR before a dependency using one is added. Dependencies with no declared license or with a custom license need the same. [ADR 0022](adr/0022-axe-core-development-dependency.md) admits copyleft build- and test-time tooling that enters nothing we distribute; today `axe-core` and `@axe-core/playwright` (accessibility tests) and `lightningcss` (Vite 8's CSS minifier), each named in the check's exception list. The same list names `pako` (MIT AND Zlib, both permissive), a dependency of the `autocannon` load generator that only the load test in [performance.md](performance.md) runs.

This list is the policy. The authoritative allowlist that CI enforces lives in `scripts/check-licenses.mjs`, and any change here must be mirrored there.
