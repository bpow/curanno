# 0022. Copyleft licenses are allowed for build- and test-time tooling that ships nothing

**Status:** Accepted

**Date:** 2026-10-30

## Context

The dependency license policy ([third-party-notices.md](../third-party-notices.md)) admits copyleft licenses, the Mozilla Public License among them, only through an accepted ADR. Two Phase 5 needs ran into it:

- The accessibility pass automates checks of the sidebar, the PDF viewer and the management site with axe, the rules engine behind most accessibility tooling, through `@axe-core/playwright` in the Playwright suites. Both packages are MPL-2.0, and no comparable engine exists under a permitted license.
- The security review found Nuxt 4.3 carrying high and critical advisories in the server that renders the management site; the fixed releases (4.6 and later) build with Vite 8, whose CSS minifier `lightningcss` is MPL-2.0. The sidebar and the viewer had stayed on Vite 7 for that reason.

In both cases the covered code runs only while building or testing. Nothing we distribute (the API image, the built sidebar, viewer and site, the guest bundle) contains it, and we modify none of it, so MPL-2.0's obligations, which attach to distributing the covered files or modifications of them, do not arise.

## Decision

Copyleft-licensed packages are allowed when they are **build- or test-time tooling** whose code enters nothing we distribute: test runners and their plugins, bundlers, minifiers and their plugins. Each such package is still named, with the reason, in the exception list of `scripts/check-licenses.mjs`, so a copyleft dependency arriving in a runtime path still fails the check. Today the list is `axe-core` and `@axe-core/playwright` (accessibility tests), and `lightningcss` with its platform binaries (Vite 8's CSS minifier, through Nuxt). A copyleft package in a runtime path, such as one bundled into a client or installed in an image, still needs a decision of its own.

## Consequences

- The management site runs on a patched Nuxt, and the accessibility suites fail CI with axe's rule names, which point at the fix.
- The sidebar and the viewer may move to Vite 8 when convenient; nothing holds them on Vite 7 any more.
- Reviewers of dependency changes check two things for a copyleft package: that it is in the exception list with a reason, and that it is not in a runtime path (`pnpm why` shows the path).

## References

- [Dependency license policy](../third-party-notices.md)
- [axe-core](https://github.com/dequelabs/axe-core), [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm), [lightningcss](https://lightningcss.dev)
- [docs/accessibility.md](../accessibility.md), [docs/security-review.md](../security-review.md)
