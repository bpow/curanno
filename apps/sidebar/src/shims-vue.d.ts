// For tools that type-check with plain TypeScript (ESLint). vue-tsc resolves
// the real component types and ignores this wildcard.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
