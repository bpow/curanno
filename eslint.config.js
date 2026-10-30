import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.claude/**',
      // Generated from the OpenAPI document; not hand-edited.
      'packages/api-client/src/schema.ts',
      // Trial build output and third-party code kept verbatim (see its PROVENANCE.md).
      'packages/guest/trial/.build/**',
      'packages/guest/test/.build/**',
      'packages/guest/build/**',
      'packages/guest/vendor/**',
      'apps/sidebar/playwright-report/**',
      'apps/sidebar/test-results/**',
      'apps/web/.nuxt/**',
      'apps/web/.output/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    files: ['apps/sidebar/src/**', 'apps/web/app/**', 'apps/pdf-viewer/src/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Nuxt names pages and layouts by file path.
    files: ['apps/web/app/pages/**', 'apps/web/app/layouts/**', 'apps/web/app/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    // The management site is an ordinary client of the public API (ADR
    // 0009): nothing runs in Nuxt's server layer, so any file there fails.
    files: ['apps/web/server/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'The management site has no server routes (ADR 0009). Add the capability to the API instead.',
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
