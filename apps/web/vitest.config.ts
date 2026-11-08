import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Components are tested with plain @vue/test-utils: they import everything
// explicitly (nuxt.config.ts turns auto-imports off), so no Nuxt runtime is
// needed here.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '#components': fileURLToPath(new URL('./app/test/nuxt-components.ts', import.meta.url)),
      '#imports': fileURLToPath(new URL('./app/test/nuxt-imports.ts', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['app/**/*.test.ts'],
  },
});
