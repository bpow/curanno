# 0022. axe-core (MPL-2.0) as a development-only dependency for accessibility tests

**Status:** Accepted

**Date:** 2026-10-30

## Context

The dependency license policy ([third-party-notices.md](../third-party-notices.md)) admits copyleft licenses, the Mozilla Public License among them, only through an accepted ADR. The Phase 5 accessibility pass (plan, Phase 5) automates checks of the sidebar, the PDF viewer and the management site with axe, the rules engine behind most accessibility tooling, through `@axe-core/playwright` in the Playwright suites. Both packages are MPL-2.0. No comparable engine under a permitted license exists; writing the checks by hand would cover a fraction of the rules.

## Decision

`axe-core` and `@axe-core/playwright` are allowed as **development dependencies only**: they are installed for the Playwright suites of `apps/sidebar` and `apps/web`, run in CI, and never enter a built bundle, an image or anything distributed. The license check records them as the one exception, with this ADR as the reason. Any use that would ship them (an in-app accessibility checker, say) needs a new decision.

## Consequences

- MPL-2.0's obligations attach to modifications of the covered files; we make none, and nothing we distribute contains them.
- The exception is named per package in `scripts/check-licenses.mjs`, so an MPL dependency arriving by another route still fails the check.
- Accessibility regressions in the three Playwright suites fail CI with axe's rule names, which point at the fix.

## References

- [Dependency license policy](../third-party-notices.md)
- [axe-core](https://github.com/dequelabs/axe-core), [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm)
- [docs/accessibility.md](../accessibility.md)
