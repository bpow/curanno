import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
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
      'packages/guest/vendor/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
