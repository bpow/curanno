/**
 * In-page guest (ADR 0007, 0008): selection, anchoring and highlights in
 * the annotated page, talking to the sidebar over the RPC protocol in
 * `@scale/model`. This entry point is the library; `bundle.ts` is the
 * self-contained script the bookmarklet injects.
 */
export * from './anchoring/index.js';
