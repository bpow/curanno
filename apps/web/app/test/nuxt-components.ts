/**
 * Stand-ins for Nuxt's built-in components in component tests, where no
 * Nuxt runtime exists: vitest.config.ts aliases `#components` here.
 */
import { defineComponent, h } from 'vue';

export const NuxtLink = defineComponent({
  name: 'NuxtLink',
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) {
    return () =>
      h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots['default']?.());
  },
});
