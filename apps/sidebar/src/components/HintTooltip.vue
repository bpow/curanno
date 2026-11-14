<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';

defineProps<{ text: string }>();
// The root renders nothing, so what a wrapping as-child trigger passes goes on to the button.
defineOptions({ inheritAttrs: false });
</script>

<template>
  <TooltipRoot>
    <TooltipTrigger as-child v-bind="$attrs">
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="hint-tooltip" side="bottom" :side-offset="4" :collision-padding="8">
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
