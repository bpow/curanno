# 0008. The in-page guest is framework-free TypeScript

**Status:** Accepted

**Date:** 2026-10-29

## Context

The guest script runs inside pages we do not control, alongside whatever frameworks and styles those pages use. A guest that loads Vue or a UI library adds weight to every annotated page, risks conflicts with the page's own framework, and increases the surface exposed to host-page scripts. Its responsibilities are narrow: selection, anchoring and drawing highlights.

The analysis note identifies two serious bases for the guest's anchoring code, Recogito Text Annotator and the Hypothesis guest code, and a source of building blocks in Apache Annotator. Their re-anchoring quality differs, and the note recommends a trial on real pages before choosing.

## Decision

The guest is written in framework-free TypeScript. It must be small, must not depend on Vue or any UI library, and must not fight the host page's scripts or CSS. Any controls it draws use Shadow DOM for style isolation, while recognising that Shadow DOM is not a security boundary.

Which library the guest's anchoring is built from (Recogito with a quote-matching fallback, or copied Hypothesis guest code) is decided by the Phase 2 trial and recorded in its own ADR, not here.

## Consequences

- The guest stays light and its behaviour in foreign pages is predictable.
- Any UI the guest needs (an adder button, highlight hover states) is written by hand without component abstractions, which is more work per feature than in the sidebar.
- Code cannot be shared freely between guest and sidebar; only `packages/model` is common to both, and it must stay free of DOM and framework dependencies.
- Highlight rendering and layout tracking are the guest's own problem whichever base is chosen, and must be tested against pages that re-render their DOM.

## References

- [Analysis note: In-page guest](../web-annotation-replacement.md#3-in-page-guest)
- [Project plan: Phase 2](../web-annotation-plan.md#phase-2-guest-trial-23-weeks-parallel-with-phase-1)
